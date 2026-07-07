# CLAUDE.md — Media Gallery

## Workflow

**Ne jamais push sans que l'utilisateur le demande explicitement.**

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
**Bumper la version à chaque modification de `app.js` ou `style.css`.** nginx/StaticFiles sert ces fichiers avec `Cache-Control: max-age=14400` (4h) — sans bump, les navigateurs gardent l'ancienne version en cache, ça s'est déjà produit.

Les fichiers du jeu ont leur propre versioning dans `game/index.html` (`game.css?v=N`, `game.js?v=N`) — même règle, à bumper séparément si tu touches `static/game/*`.

## Compte partagé (cooloss)

Depuis juillet 2026, Memoss reconnaît les comptes du hub **cooloss** (`https://cooloss.nathangracia.com`) via le cookie partagé `nathangracia_session` — voir `~/docs/compte-unifie-cooloss.md` sur le VPS pour l'architecture complète (token, migration, autres apps). Résumé local :

- `server/shared_auth.py` : vérifie le cookie (HMAC-SHA256, secret `shared_session_secret` dans `config.yaml`, jamais committé).
- `GET /api/whoami` : `{loggedIn, username, displayName, isAdmin, avatarFile}` — le frontend (`app.js`, `game.js`, `timeline.html`) l'appelle au chargement, pas de lecture directe du cookie côté client (il est HttpOnly).
- Le feeder .exe est **inchangé**, toujours sur `x-api-key` — c'est un chemin d'auth séparé, pas remplacé par cooloss.
- Dans le jeu (`create_room`/`join_room`), l'identité vient du cookie vérifié côté serveur, jamais du pseudo envoyé par le client — connecté = pseudo verrouillé sur `displayName || username`, `account_uid` stocké sur `GamePlayer`/`GameAnswer`.

## API endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/upload` | `x-api-key` (feeder) | Upload feeder |
| `GET` | `/api/media` | non | Liste paginée (filtres: type, feeder, tag, page, per_page) |
| `GET` | `/api/media/{uuid}` | non | Détail d'un média |
| `GET` | `/api/whoami` | non | Session cooloss courante (voir ci-dessus) |
| `PATCH` | `/api/media/{uuid}/tag` | `x-api-key` OU session admin | Changer le tag |
| `POST` | `/api/media/{uuid}/crop` | `x-api-key` OU session admin | Rogner haut/bas → crée un nouveau média |
| `DELETE` | `/api/media/{uuid}` | `x-api-key` OU session admin | Supprimer |
| `GET` | `/api/storage` | non | Info quota |
| `GET` | `/api/feeders` | non | Liste des feeders |
| `POST` | `/game/api/rooms` | non (identité optionnelle via cookie) | Créer une partie |
| `POST` | `/game/api/rooms/{code}/join` | non (identité optionnelle via cookie) | Rejoindre une partie |
| `GET` | `/game/api/timeline` | non | Historique des légendes, groupé par partie |

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
