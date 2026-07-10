"""
Backfill ponctuel de Media.duration_seconds pour les vidéos déjà en base
avant l'ajout de la colonne. Run manuel une fois, pas au démarrage du
serveur (inutile de re-scanner ~200 fichiers à chaque boot).

Usage :
    docker compose exec gallery python scripts/backfill_duration.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select  # noqa: E402

from main import MEDIA_DIR, Media, engine, gen_video_duration  # noqa: E402


def main() -> None:
    with Session(engine) as session:
        rows = session.exec(
            select(Media).where(Media.media_type == "video", Media.duration_seconds.is_(None))
        ).all()
        print(f"{len(rows)} vidéo(s) sans duration_seconds.")

        updated = 0
        for m in rows:
            path = MEDIA_DIR / m.filename
            if not path.exists():
                print(f"  ✗ {m.filename} : fichier introuvable, ignoré")
                continue
            duration = gen_video_duration(path)
            if duration is None:
                print(f"  ✗ {m.filename} : ffprobe échoué, ignoré")
                continue
            m.duration_seconds = duration
            session.add(m)
            updated += 1

        session.commit()
        print(f"{updated} média(s) mis à jour.")


if __name__ == "__main__":
    main()
