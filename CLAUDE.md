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
- `GET /api/whoami` : `{loggedIn, username, displayName, isAdmin, isHabitue, avatarFile}` — pas de lecture directe du cookie côté client (il est HttpOnly).
- **Rôle "habitué"** (`isHabitue`, géré depuis `/admin` sur cooloss) : accès en lecture à `/timeline` et à l'historique des légendes d'un média, sans les droits de modération (delete/tag/crop restent `isAdmin` uniquement). Gate côté serveur : `require_admin_or_habitue` dans `game_router.py`, appliqué à `GET /game/api/timeline` et `GET /game/api/history/{uuid}` — ces deux endpoints n'avaient AUCUNE auth serveur avant (juste un lock-screen client-side), corrigé en même temps que l'ajout du rôle. Gate côté client : `canSeeLegends()` dans `app.js`.
- `static/account-widget.js` : module partagé par `index.html`, `timeline.html` et `game/index.html` — fetch `/api/whoami` + rend le bouton compte (avatar, dropdown "Modifier le profil" / "Se déconnecter") dans `<div id="account-widget"></div>`. **Seul point qui fetch whoami** — `app.js`/`game.js` lisent `AccountWidget.session` plutôt que de refetch chacun de leur côté.
- Le feeder .exe est **inchangé**, toujours sur `x-api-key` — c'est un chemin d'auth séparé, pas remplacé par cooloss.
- Dans le jeu (`create_room`/`join_room`), l'identité vient du cookie vérifié côté serveur, jamais du pseudo envoyé par le client — connecté = pseudo verrouillé sur `displayName || username`, `account_uid` stocké sur `GamePlayer`/`GameAnswer`.
- **Reprise auto de partie** : un compte connecté qui recharge `/game/` (ou se reconnecte après une déco) rejoint automatiquement sa room en cours via `GET /game/api/my-room` (cherche `account_uid` dans `game_states` en mémoire) — pas d'équivalent pour les invités, pas d'identité stable à matcher après un reload.

## API endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/upload` | `x-api-key` (feeder) | Upload feeder |
| `GET` | `/api/media` | non | Liste paginée (filtres: type, feeder, tag, page, per_page) |
| `GET` | `/api/media/{uuid}` | non | Détail d'un média |
| `GET` | `/api/whoami` | non | Session cooloss courante (voir ci-dessus) |
| `GET` | `/game/api/timeline` | admin OU habitué | Historique des légendes, groupé par partie |
| `GET` | `/game/api/history/{uuid}` | admin OU habitué | Légendes proposées pour un média donné |
| `PATCH` | `/api/media/{uuid}/tag` | `x-api-key` OU session admin | Changer le tag |
| `POST` | `/api/media/{uuid}/crop` | `x-api-key` OU session admin | Rogner haut/bas → crée un nouveau média |
| `DELETE` | `/api/media/{uuid}` | `x-api-key` OU session admin | Supprimer |
| `GET` | `/api/storage` | non | Info quota |
| `GET` | `/api/feeders` | non | Liste des feeders |
| `POST` | `/game/api/rooms` | non (identité optionnelle via cookie) | Créer une partie |
| `POST` | `/game/api/rooms/{code}/join` | non (identité optionnelle via cookie) | Rejoindre une partie |
| `GET` | `/game/api/my-room` | non (identité optionnelle via cookie) | Room active du compte connecté, pour reprise auto |
| `GET` | `/api/shardoss/stats` | `x-api-key` (clé dédiée Shardoss) | Population complète des médias tag=cinema/vidéo (popularité/qualité/durée), pour le recalcul quotidien de Shardoss |

## Shardoss (jeu idle connecté)

Depuis juillet 2026, Memoss notifie un service séparé, **Shardoss** (repo `NathanGracia/shardoss`, sa propre DB), à la fin de chaque partie — un jeu idle/clicker où la collection de memes dérive des stats d'usage réelles de Memoss. Voir `docs/plan.md` et `docs/whitepaper.md` dans le repo Shardoss pour l'architecture complète.

- `server/shardoss_client.py::notify_shardoss()` : appelé en fire-and-forget (`asyncio.create_task`, jamais awaité) depuis `end_game()` dans `game_router.py`, juste après `_save_to_db()`. Timeout court (3s), avale toute exception — une panne/lenteur de Shardoss ne doit **jamais** impacter une partie Memoss en cours. `shardoss_base_url`/`shardoss_webhook_key` vides en dev = no-op silencieux.
- Le payload envoyé contient les légendes brutes de toute la partie (`account_uid`, `media_uuid`, `total_stars`, `vote_count`) — c'est Shardoss qui trie et calcule les rangs, pas Memoss. Ne pas essayer de "simplifier" ce payload en renvoyant un classement déjà calculé : le rang qui compte côté Shardoss est celui des légendes, pas celui des joueurs, et cette logique vit uniquement côté Shardoss.
- `GET /api/shardoss/stats` (gated par une clé API dédiée dans `api_keys:`, distincte de celle du feeder) expose la galerie complète (y compris médias à 0 vue) — Shardoss en a besoin pour calculer des percentiles corrects sur toute la population, pas seulement les médias déjà joués.
- `Media.duration_seconds` : extrait via `ffprobe` à l'upload (`gen_video_duration()`, à côté de `gen_video_thumb()`). Backfill ponctuel pour les vidéos déjà en base : `docker compose exec gallery python scripts/backfill_duration.py`.

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
