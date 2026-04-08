"""
Gestion du démarrage automatique Windows via le Task Scheduler.
"""
import sys
import subprocess
import logging
from pathlib import Path

log = logging.getLogger(__name__)

TASK_NAME = "MediaFeeder_v3"


def _get_exe_path() -> str:
    """Retourne le chemin de l'exécutable courant (.exe ou python main.py)."""
    if getattr(sys, 'frozen', False):
        # Exécutable PyInstaller
        return str(Path(sys.executable).resolve())
    else:
        # Mode développement: python main.py
        main = (Path(__file__).parent / "main.py").resolve()
        return f'"{sys.executable}" "{main}"'


def install_autostart():
    exe = _get_exe_path()
    cmd = [
        "schtasks", "/Create",
        "/TN", TASK_NAME,
        "/TR", exe,
        "/SC", "ONLOGON",
        "/RL", "HIGHEST",
        "/F",               # Écraser si existant
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        log.info(f"Tâche planifiée créée: {TASK_NAME}")
    else:
        log.warning(f"Impossible de créer la tâche planifiée: {result.stderr.strip()}")


def uninstall_autostart():
    cmd = ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        log.info(f"Tâche planifiée supprimée: {TASK_NAME}")
    else:
        log.warning(f"Impossible de supprimer la tâche: {result.stderr.strip()}")


def is_installed() -> bool:
    result = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME],
        capture_output=True, text=True,
    )
    return result.returncode == 0


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description="Gestion du démarrage automatique")
    parser.add_argument("action", choices=["install", "uninstall", "status"])
    args = parser.parse_args()

    if args.action == "install":
        install_autostart()
    elif args.action == "uninstall":
        uninstall_autostart()
    elif args.action == "status":
        print("Installé" if is_installed() else "Non installé")
