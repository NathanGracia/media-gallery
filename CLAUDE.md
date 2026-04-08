# CLAUDE.md — Media Gallery

## Workflow

**Toujours tester en local avant de push.**

```bash
# Lancer le serveur local
cd server && python main.py
# → http://127.0.0.1:8000
```

Le serveur local a sa propre DB (`server/db.sqlite`) et ses médias (`server/media/`).  
Ne pas committer `server/db.sqlite`, `server/media/`, `server/thumbnails/`, `server/config.yaml`.

## Stack

- **Serveur** : FastAPI + SQLModel (SQLite) + Pillow + FFmpeg
- **Frontend** : Vanilla JS/CSS/HTML (SPA), Plyr pour le player vidéo
- **Feeder** : Python (watchdog + requests), compilable en .exe via PyInstaller
- **Deploy** : Docker Compose sur VPS Ubuntu, CI/CD via GitHub Actions (push main → auto-deploy)

## Tags

Trois tags valides : `todo` (défaut), `cinema`, `osef`.  
Filtre dans `list_media` : pensez à inclure les 3 dans la condition.

## Versionning du cache frontend

Les fichiers statiques sont référencés avec `?v=N` dans `index.html`.  
**Bumper la version à chaque modification de `app.js` ou `style.css`.**  
Version actuelle : `v=12`.

## API endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/upload` | oui | Upload feeder |
| `GET` | `/api/media` | non | Liste paginée (filtres: type, feeder, tag, page, per_page) |
| `GET` | `/api/media/{uuid}` | non | Détail d'un média |
| `PATCH` | `/api/media/{uuid}/tag` | non | Changer le tag |
| `POST` | `/api/media/{uuid}/crop` | non | Rogner haut/bas → crée un nouveau média |
| `DELETE` | `/api/media/{uuid}` | oui | Supprimer |
| `GET` | `/api/storage` | non | Info quota |
| `GET` | `/api/feeders` | non | Liste des feeders |

## Crop vidéo

- Endpoint : `POST /api/media/{uuid}/crop?top_pct=X&bottom_pct=Y` (X, Y en %, 0-49)
- Utilise `ffprobe` pour les dimensions, `ffmpeg` pour le crop
- Crée un **nouveau** fichier + nouvelle entrée DB (l'original est conservé)
- Retourne `{"ok": true, "id": new_uuid}`
- Le frontend fetch ensuite `GET /api/media/{new_uuid}` pour ouvrir le player sur le nouveau média

## Feeder

- Config dans `feeder/config.json` (ignoré par git — contient la clé API)
- Déduplication par hash MD5 dans `feeder/sent_files.json`
- Autostart via Task Scheduler : `python feeder/autostart.py install` (admin requis)
- Pour lancer manuellement : `python feeder/main.py`

## Migration DB

Le serveur applique les migrations au démarrage via `ALTER TABLE` dans un try/except.  
Ajouter toute nouvelle colonne dans ce bloc. Penser aussi à migrer les données existantes si besoin (ex: renommage de valeurs de tag).
