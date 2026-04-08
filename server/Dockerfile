FROM python:3.11-slim

# ffmpeg pour les thumbnails vidéo
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances d'abord (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Code source
COPY main.py .
COPY game_models.py .
COPY game_router.py .
COPY static/ static/

# Les données (media, thumbnails, db, config) sont montées en volumes
# → non copiées dans l'image

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
