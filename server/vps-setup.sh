#!/bin/bash
# ── Setup initial du VPS (à lancer une seule fois en root) ────────────────────
# Ce script installe Docker, clone le repo et configure le déploiement.
set -e

# ── Variables à adapter ───────────────────────────────────────────────────────
REPO_URL="https://github.com/TON_USER/TON_REPO.git"   # ← modifier
APP_DIR="/opt/media-gallery"
DEPLOY_USER="deploy"        # Utilisateur non-root pour le déploiement

# ── Docker ────────────────────────────────────────────────────────────────────
echo "==> Installation de Docker..."
apt-get update -qq
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# ── Utilisateur deploy ────────────────────────────────────────────────────────
echo "==> Création de l'utilisateur $DEPLOY_USER..."
id -u "$DEPLOY_USER" &>/dev/null || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

# ── Clé SSH pour GitHub Actions ───────────────────────────────────────────────
echo "==> Génération de la clé SSH pour GitHub Actions..."
SSH_DIR="/home/$DEPLOY_USER/.ssh"
mkdir -p "$SSH_DIR"
ssh-keygen -t ed25519 -C "github-actions-deploy" -f "$SSH_DIR/deploy_key" -N ""
cat "$SSH_DIR/deploy_key.pub" >> "$SSH_DIR/authorized_keys"
chmod 700 "$SSH_DIR" && chmod 600 "$SSH_DIR/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR"

echo ""
echo "  ┌─────────────────────────────────────────────────────────────────┐"
echo "  │  Clé privée à ajouter dans GitHub Secrets (VPS_SSH_KEY) :      │"
echo "  └─────────────────────────────────────────────────────────────────┘"
cat "$SSH_DIR/deploy_key"
echo ""

# ── Clone du repo ─────────────────────────────────────────────────────────────
echo "==> Clonage du repo..."
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$APP_DIR"

# ── Config initiale ───────────────────────────────────────────────────────────
echo "==> Création de config.yaml depuis l'exemple..."
cp "$APP_DIR/server/config.yaml.example" "$APP_DIR/server/config.yaml"
touch "$APP_DIR/server/db.sqlite" "$APP_DIR/server/gallery.log"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/server"

# Générer une clé API
API_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo ""
echo "  Clé API générée: $API_KEY"
echo "  → Ajoutez-la dans $APP_DIR/server/config.yaml (api_keys)"
echo "  → Et dans vos feeders (champ 'Clé API')"
echo ""

# ── Premier démarrage ─────────────────────────────────────────────────────────
echo "==> Démarrage initial..."
cd "$APP_DIR/server"
sudo -u "$DEPLOY_USER" docker compose up -d --build

echo ""
echo "✓ Setup terminé!"
echo ""
echo "  Prochaines étapes :"
echo "  1. Éditer la config : nano $APP_DIR/server/config.yaml"
echo "     - Webhook Discord, clé API, quota"
echo "  2. Redémarrer : cd $APP_DIR/server && docker compose restart"
echo ""
echo "  GitHub Actions Secrets à configurer :"
echo "  ┌──────────────────┬──────────────────────────────────────────┐"
echo "  │ VPS_HOST         │ IP ou domaine de ce VPS                  │"
echo "  │ VPS_USER         │ $DEPLOY_USER                             │"
echo "  │ VPS_SSH_KEY      │ Clé privée affichée ci-dessus            │"
echo "  │ VPS_PORT         │ 22 (par défaut)                          │"
echo "  │ VPS_APP_DIR      │ $APP_DIR                                 │"
echo "  └──────────────────┴──────────────────────────────────────────┘"
