"""
MediaFeeder Tray — Icône barre des tâches Windows
Lance MediaFeeder en arrière-plan et affiche son état dans la barre système.
"""
import sys
import threading
import os
from pathlib import Path

from PIL import Image, ImageDraw
import pystray

# ── Paths ──────────────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    BASE_DIR = Path(sys.executable).parent
else:
    BASE_DIR = Path(__file__).parent

sys.path.insert(0, str(BASE_DIR))
LOG_FILE = BASE_DIR / "feeder.log"

# ── State ──────────────────────────────────────────────────────────────────────
_stop_event: threading.Event = None
_feeder_thread: threading.Thread = None
_tray_icon: pystray.Icon = None
_lock = threading.Lock()


# ── Icon drawing ───────────────────────────────────────────────────────────────
def _make_icon(status: str) -> Image.Image:
    """Crée une icône ronde 64×64 RGBA."""
    colors = {
        "on":    "#22c55e",   # vert
        "off":   "#6b7280",   # gris
        "error": "#ef4444",   # rouge
    }
    color = colors.get(status, "#6b7280")
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([6, 6, 58, 58], fill=color)
    return img


# ── Feeder control ─────────────────────────────────────────────────────────────
def _feeder_alive() -> bool:
    with _lock:
        return _feeder_thread is not None and _feeder_thread.is_alive()


def _start_feeder():
    global _stop_event, _feeder_thread
    with _lock:
        if _feeder_thread is not None and _feeder_thread.is_alive():
            return
        import main as feeder
        _stop_event = threading.Event()
        _feeder_thread = threading.Thread(
            target=feeder.run,
            args=(_stop_event,),
            daemon=True,
            name="FeederThread",
        )
        _feeder_thread.start()


def _stop_feeder():
    global _stop_event, _feeder_thread
    with _lock:
        if _stop_event:
            _stop_event.set()
        t = _feeder_thread
        _feeder_thread = None
        _stop_event = None
    if t:
        t.join(timeout=5)


# ── Icon update ────────────────────────────────────────────────────────────────
def _update_icon():
    if _tray_icon is None:
        return
    if _feeder_alive():
        _tray_icon.icon = _make_icon("on")
        _tray_icon.title = "MediaFeeder — ON"
    else:
        _tray_icon.icon = _make_icon("off")
        _tray_icon.title = "MediaFeeder — OFF"


def _monitor_loop():
    """Surveille le thread feeder et met à jour l'icône toutes les 3s."""
    import time
    while True:
        _update_icon()
        time.sleep(3)


# ── Menu actions ───────────────────────────────────────────────────────────────
def _action_toggle(icon, item):
    if _feeder_alive():
        _stop_feeder()
    else:
        _start_feeder()
    _update_icon()


def _action_logs(icon, item):
    if LOG_FILE.exists():
        os.startfile(str(LOG_FILE))


def _action_quit(icon, item):
    _stop_feeder()
    icon.stop()


def _toggle_label(item) -> str:
    return "Arrêter le feeder" if _feeder_alive() else "Démarrer le feeder"


# ── Tray setup ─────────────────────────────────────────────────────────────────
def _setup(icon):
    icon.visible = True
    _start_feeder()
    _update_icon()
    threading.Thread(target=_monitor_loop, daemon=True).start()


def main():
    global _tray_icon
    _tray_icon = pystray.Icon(
        "MediaFeeder",
        _make_icon("off"),
        "MediaFeeder — démarrage...",
        menu=pystray.Menu(
            pystray.MenuItem(_toggle_label, _action_toggle),
            pystray.MenuItem("Voir les logs", _action_logs),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quitter", _action_quit),
        ),
    )
    _tray_icon.run(setup=_setup)


if __name__ == "__main__":
    main()
