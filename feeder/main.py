"""
MediaFeeder v3 — Point d'entrée principal
Surveille un dossier local et upload les médias vers le serveur galerie.
"""
import sys
import json
import time
import hashlib
import logging
import threading
import msvcrt
from pathlib import Path

import requests
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── Resolve base directory (works both as .py and .exe PyInstaller) ────────────
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent

CONFIG_FILE = BASE_DIR / "config.json"
SENT_FILE   = BASE_DIR / "sent_files.json"
LOG_FILE    = BASE_DIR / "feeder.log"
LOCK_FILE   = BASE_DIR / "feeder.lock"

# ── Single-instance lock ───────────────────────────────────────────────────────
_lock_fh = None  # garde le handle ouvert tant que le processus vit

def _acquire_instance_lock() -> bool:
    """Retourne True si cette instance a obtenu le verrou exclusif."""
    global _lock_fh
    try:
        _lock_fh = open(LOCK_FILE, "w")
        msvcrt.locking(_lock_fh.fileno(), msvcrt.LK_NBLCK, 1)
        return True
    except (IOError, OSError):
        if _lock_fh:
            _lock_fh.close()
            _lock_fh = None
        return False

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
ALL_EXTS   = VIDEO_EXTS | IMAGE_EXTS
MAX_SIZE   = 25 * 1024 * 1024   # 25 MB


# ── Config helpers ─────────────────────────────────────────────────────────────
def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, encoding="utf-8") as f:
            return json.load(f)
    return None


def save_config(cfg: dict):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


# ── File helpers ───────────────────────────────────────────────────────────────
def file_md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def wait_stable(path: Path, interval: float = 1.5, required: int = 3) -> bool:
    """Attend que le fichier ne grossisse plus (copie en cours)."""
    prev_size = -1
    stable_count = 0
    for _ in range(30):  # timeout ~45s
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return False
        if size == prev_size:
            stable_count += 1
            if stable_count >= required:
                return True
        else:
            stable_count = 0
        prev_size = size
        time.sleep(interval)
    return False


# ── Main feeder logic ──────────────────────────────────────────────────────────
def run(stop_event: threading.Event = None):
    """
    Point d'entrée du feeder. Bloque jusqu'à ce que stop_event soit déclenché
    (ou KeyboardInterrupt si lancé en standalone).
    """
    if stop_event is None:
        stop_event = threading.Event()

    # ── Single-instance guard ─────────────────────────────────────────────────
    if not _acquire_instance_lock():
        log.warning("Une autre instance du feeder est déjà en cours — arrêt.")
        return

    # ── Config ────────────────────────────────────────────────────────────────
    config = load_config()
    if config is None:
        log.info("Aucune configuration trouvée — ouverture de l'interface...")
        from config_ui import show_config_ui
        config = show_config_ui()
        if config is None:
            log.info("Configuration annulée — arrêt.")
            return
        save_config(config)
        log.info("Configuration sauvegardée.")
        try:
            from autostart import install_autostart
            install_autostart()
            log.info("Démarrage automatique configuré.")
        except Exception as e:
            log.warning(f"Autostart non configuré: {e}")

    for key in ("server_url", "api_key", "feeder_name", "folder_path"):
        if not config.get(key):
            log.error(f"Config invalide: clé '{key}' manquante.")
            return

    FOLDER = Path(config["folder_path"])
    if not FOLDER.exists():
        log.error(f"Dossier surveillé introuvable: {FOLDER}")
        return

    log.info(f"Feeder: {config['feeder_name']}")
    log.info(f"Serveur: {config['server_url']}")
    log.info(f"Dossier: {FOLDER}")

    # ── Sent files history (by MD5 hash) ──────────────────────────────────────
    _sent_lock = threading.Lock()
    sent_files: set

    if SENT_FILE.exists():
        with open(SENT_FILE, encoding="utf-8") as f:
            sent_files = set(json.load(f))
    else:
        sent_files = set()

    def mark_sent(fhash: str):
        with _sent_lock:
            sent_files.add(fhash)
            with open(SENT_FILE, "w", encoding="utf-8") as f:
                json.dump(list(sent_files), f)

    def is_sent(fhash: str) -> bool:
        with _sent_lock:
            return fhash in sent_files

    # ── Upload ────────────────────────────────────────────────────────────────
    def is_valid(path: Path) -> bool:
        if path.suffix.lower() not in ALL_EXTS:
            return False
        try:
            if path.stat().st_size > MAX_SIZE:
                log.warning(f"Ignoré (>25MB): {path.name}")
                return False
        except FileNotFoundError:
            return False
        return True

    def upload(path: Path) -> bool:
        url = config["server_url"].rstrip("/") + "/upload"
        headers = {
            "x-api-key":   config["api_key"],
            "feeder-name": config["feeder_name"],
        }
        for attempt in range(1, 4):
            try:
                with open(path, "rb") as f:
                    resp = requests.post(
                        url,
                        files={"file": (path.name, f)},
                        headers=headers,
                        timeout=120,
                    )
                if resp.status_code == 200:
                    return True
                log.error(f"Erreur {resp.status_code}: {resp.text[:200]}")
                if resp.status_code in (401, 507):
                    return False
            except requests.exceptions.ConnectionError:
                log.error(f"Connexion impossible au serveur (tentative {attempt}/3)")
            except Exception as e:
                log.error(f"Tentative {attempt}/3 échouée: {e}")
            if attempt < 3:
                time.sleep(2 ** attempt)
        return False

    def process(path: Path):
        if stop_event.is_set():
            return
        if not path.is_file() or not is_valid(path):
            return
        if not wait_stable(path):
            log.warning(f"Fichier instable (timeout): {path.name}")
            return
        try:
            fhash = file_md5(path)
        except Exception:
            return
        if is_sent(fhash):
            return
        log.info(f"Upload: {path.name} ({path.stat().st_size/1024/1024:.1f} MB)")
        if upload(path):
            mark_sent(fhash)
            log.info(f"✓ Envoyé: {path.name}")
        else:
            log.error(f"✗ Échec: {path.name}")

    # ── Watchdog handler ──────────────────────────────────────────────────────
    class MediaHandler(FileSystemEventHandler):
        def on_created(self, event):
            if not event.is_directory:
                threading.Thread(
                    target=process, args=(Path(event.src_path),), daemon=True
                ).start()

        def on_moved(self, event):
            if not event.is_directory:
                threading.Thread(
                    target=process, args=(Path(event.dest_path),), daemon=True
                ).start()

    # ── Scan initial ──────────────────────────────────────────────────────────
    log.info("Scan initial du dossier (récursif)...")
    initial_threads = []
    for f in FOLDER.rglob("*"):
        if f.is_file():
            t = threading.Thread(target=process, args=(f,), daemon=True)
            t.start()
            initial_threads.append(t)
    for t in initial_threads:
        t.join(timeout=180)
    log.info("Scan initial terminé — surveillance en cours...")

    # ── Start observer ────────────────────────────────────────────────────────
    observer = Observer()
    observer.schedule(MediaHandler(), str(FOLDER), recursive=True)
    observer.start()

    try:
        while not stop_event.is_set():
            time.sleep(1)
            if not observer.is_alive():
                log.error("Observer mort — redémarrage...")
                observer = Observer()
                observer.schedule(MediaHandler(), str(FOLDER), recursive=True)
                observer.start()
    except KeyboardInterrupt:
        pass
    finally:
        observer.stop()
        observer.join()
        log.info("MediaFeeder arrêté.")
        # Relâche le verrou inter-processus
        global _lock_fh
        if _lock_fh:
            try:
                msvcrt.locking(_lock_fh.fileno(), msvcrt.LK_UNLCK, 1)
                _lock_fh.close()
            except Exception:
                pass
            _lock_fh = None


if __name__ == "__main__":
    run()
