#!/bin/bash
# ── Media Gallery v3 — Script d'installation Ubuntu ───────────────────────────
set -e

APP_DIR="/opt/media-gallery"
SERVICE_NAME="media-gallery"
USER="www-data"

echo "==> Installation des dépendances système..."
apt-get update -qq
apt-get install -y python3 python3-pip python3-venv ffmpeg

echo "==> Création du dossier d'application: $APP_DIR"
mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
chown -R "$USER:$USER" "$APP_DIR"

echo "==> Création de l'environnement virtuel..."
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip -q
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" -q

echo "==> Vérification de config.yaml..."
if [ ! -f "$APP_DIR/config.yaml" ]; then
    echo "  ATTENTION: Copie du fichier de config exemple."
    echo "  Éditez $APP_DIR/config.yaml avant de démarrer le service."
fi

echo "==> Génération d'une clé API..."
API_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
echo "  Clé API générée: $API_KEY"
echo "  → Ajoutez-la dans config.yaml (api_keys) ET dans votre feeder."

echo "==> Création du service systemd..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=Media Gallery v3
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "✓ Installation terminée!"
echo ""
echo "  1. Éditez la config : nano $APP_DIR/config.yaml"
echo "     - Ajoutez votre webhook Discord"
echo "     - Remplacez la clé API (api_keys)"
echo ""
echo "  2. Démarrez le service :"
echo "     systemctl start $SERVICE_NAME"
echo ""
echo "  3. Vérifiez le statut :"
echo "     systemctl status $SERVICE_NAME"
echo "     journalctl -u $SERVICE_NAME -f"
echo ""
echo "  4. La galerie sera accessible sur http://VOTRE_IP:8000"
echo ""
echo "  (Optionnel) Pour exposer via nginx avec SSL, ajoutez un reverse proxy."
