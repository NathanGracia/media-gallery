# Media Gallery v3

Système d'upload automatique de médias (vidéos & images) depuis plusieurs machines Windows vers un VPS, avec galerie web.

**Évolution depuis v2** — v2 envoyait les fichiers sur Discord via webhook. v3 envoie sur ton propre VPS avec une galerie web dédiée, multi-feeders, et gestion de quota.

---

## Architecture

```
[PC / Machine A]  ──┐
[PC / Machine B]  ──┤── MediaFeeder.exe ──► VPS (Docker) ──► Galerie web
[PC / Machine C]  ──┘
```

- **Feeder** — `.exe` standalone Windows. Surveille un dossier, upload les nouveaux médias.
- **Serveur** — FastAPI + Docker sur Ubuntu VPS. Stocke les médias, génère les miniatures, sert la galerie.

---

## Fonctionnalités

| | |
|---|---|
| Formats supportés | Vidéo : `.mp4` `.mov` `.webm` `.mkv` `.avi` — Image : `.jpg` `.png` `.gif` `.webp` `.bmp` |
| Quota total | 40 GB (configurable) avec alerte Discord à 80% |
| Taille max par fichier | 25 MB |
| Galerie | Miniatures, lecture vidéo inline, lightbox image, téléchargement 1 clic |
| Tags | `cinema` / `osef` / `todo` — filtrables dans la galerie |
| Crop vidéo | Rognage haut/bas depuis l'interface web (FFmpeg) — crée un nouveau média |
| Filtres | Par type (vidéo / image), par tag, par feeder |
| Multi-feeders | Plusieurs machines vers le même VPS, chacune identifiée |
| Déduplication | Hash MD5 — un fichier n'est jamais envoyé deux fois |
| Déploiement | Push `main` → GitHub Actions → deploy Docker automatique |

---

## Structure du repo

```
├── .github/workflows/deploy.yml   ← CI/CD : push → deploy VPS
├── server/
│   ├── main.py                    ← API FastAPI (upload, galerie, crop, storage)
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── config.yaml.example        ← Template de config (copier en config.yaml)
│   ├── static/                    ← Galerie web (HTML / CSS / JS)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│   ├── vps-setup.sh               ← Setup initial VPS
│   └── nginx.conf                 ← Reverse proxy optionnel (HTTPS)
└── feeder/
    ├── main.py                    ← Watchdog + upload
    ├── config_ui.py               ← UI Tkinter (1er lancement)
    ├── autostart.py               ← Task Scheduler Windows
    ├── requirements.txt
    └── build.bat                  ← Build → MediaFeeder_v3.exe
```

---

## Développement local

```bash
# Installer les dépendances serveur
pip install fastapi uvicorn sqlmodel pyyaml aiofiles requests Pillow python-multipart

# Copier la config
cp server/config.yaml.example server/config.yaml
# Éditer config.yaml : renseigner api_keys

# Lancer le serveur local
cd server && python main.py
# → http://127.0.0.1:8000
```

Le serveur local utilise SQLite (`db.sqlite`) et stocke les médias dans `server/media/`.

---

## Déploiement VPS

### Prérequis

- Ubuntu 22.04+
- Accès root pour le setup initial

### 1. Setup initial (une seule fois)

```bash
# Sur le VPS en root
curl -O https://raw.githubusercontent.com/NathanGracia/media-gallery/main/server/vps-setup.sh
bash vps-setup.sh
```

Ce script :
- Installe Docker
- Crée un utilisateur `deploy` dédié
- Génère une paire de clés SSH pour GitHub Actions
- Clone le repo dans `/opt/media-gallery`
- Lance le serveur

### 2. Config

```bash
nano /opt/media-gallery/server/config.yaml
```

```yaml
max_total_gb: 40
max_file_mb: 25
alert_threshold_pct: 80
discord_webhook_url: "https://discord.com/api/webhooks/..."
api_keys:
  - "ta_cle_api_generee"
```

> Générer une clé API : `python3 -c "import secrets; print(secrets.token_hex(32))"`

```bash
cd /opt/media-gallery/server && docker compose restart
```

### 3. GitHub Actions Secrets

Dans **Settings → Secrets and variables → Actions** du repo :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | IP ou domaine du VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Clé privée affichée par `vps-setup.sh` |
| `VPS_PORT` | `22` |
| `VPS_APP_DIR` | `/opt/media-gallery` |

### 4. Déploiement continu

```bash
git push origin main
# → GitHub Actions : SSH → git pull → docker compose up --build → healthcheck
```

Le déploiement ne touche pas aux données (médias, db, config).

---

## Commandes Docker utiles

```bash
cd /opt/media-gallery/server

docker compose up -d --build    # Rebuild et démarrer
docker compose down             # Arrêter
docker compose logs -f          # Logs en temps réel
docker compose ps               # Statut

# Backup de la base de données
scp user@vps:/opt/media-gallery/server/db.sqlite ./backup/
```

---

## Feeder Windows (.exe)

### Build

```bat
cd feeder
pip install -r requirements.txt
build.bat
# → dist/MediaFeeder_v3.exe
```

### Utilisation

1. Copier `MediaFeeder_v3.exe` sur la machine à superviser
2. Double-cliquer — une fenêtre de configuration s'ouvre au premier lancement
3. Renseigner :
   - **URL du serveur** : `http://ton-vps:8000` ou `https://ton-domaine.com`
   - **Clé API** : la clé configurée dans `config.yaml`
   - **Nom du feeder** : identifiant de cette machine (ex: `Bureau`)
   - **Dossier** : dossier local à surveiller
4. Cliquer **Enregistrer & Démarrer**
5. Le feeder se configure en démarrage automatique (Task Scheduler Windows)

Les lancements suivants démarrent directement sans UI.

Pour lancer manuellement sans build :
```bash
pip install requests watchdog
python feeder/main.py
```

> Logs dans `feeder.log` à côté de l'exécutable.

---

## Tags

Les médias peuvent être tagués depuis la galerie (hover sur la miniature) ou depuis le player :

| Tag | Usage |
|---|---|
| `todo` | Tag par défaut — média à traiter (rogner, etc.) |
| `cinema` | Média à garder / partager |
| `osef` | Média sans intérêt particulier |

---

## Crop vidéo

Depuis le player vidéo, le bouton **✂ Rogner** permet de supprimer des bandes en haut et/ou en bas de la vidéo (typiquement pour retirer le texte des mèmes).

- Ajuster les pourcentages Haut / Bas — un aperçu semi-transparent s'affiche en temps réel
- **Sauvegarder** crée un nouveau média indépendant (l'original est conservé)
- Le nouveau média s'ouvre automatiquement dans le player

---

## HTTPS avec Nginx (optionnel)

```bash
apt install nginx certbot python3-certbot-nginx
cp /opt/media-gallery/server/nginx.conf /etc/nginx/sites-available/media-gallery
# Éditer le fichier : remplacer ton-domaine.com
ln -s /etc/nginx/sites-available/media-gallery /etc/nginx/sites-enabled/
certbot --nginx -d ton-domaine.com
nginx -t && systemctl reload nginx
```

---

## Variables de config serveur

| Paramètre | Défaut | Description |
|---|---|---|
| `max_total_gb` | `40` | Quota total en GB |
| `max_file_mb` | `25` | Taille max par fichier en MB |
| `alert_threshold_pct` | `80` | Seuil alerte Discord (%) |
| `discord_webhook_url` | `""` | Webhook pour les alertes de stockage |
| `api_keys` | `[]` | Liste des clés autorisées pour les feeders |
| `host` | `0.0.0.0` | Interface d'écoute |
| `port` | `8000` | Port du serveur |
