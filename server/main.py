import os
import sys
import uuid
import datetime
import subprocess
import logging
from pathlib import Path
from typing import Optional

import yaml
import requests as req
import aiofiles
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import SQLModel, Field, Session, create_engine, select, col
from PIL import Image

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("gallery.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
CONFIG_PATH = Path("config.yaml")
if not CONFIG_PATH.exists():
    log.error("config.yaml introuvable — copie config.yaml.example vers config.yaml")
    sys.exit(1)

with open(CONFIG_PATH) as f:
    cfg = yaml.safe_load(f)

MEDIA_DIR      = Path(cfg.get("media_dir", "media"))
THUMB_DIR      = Path(cfg.get("thumb_dir", "thumbnails"))
DB_PATH        = cfg.get("db_path", "db.sqlite")
MAX_TOTAL_GB   = float(cfg.get("max_total_gb", 40))
MAX_FILE_MB    = float(cfg.get("max_file_mb", 25))
ALERT_PCT      = float(cfg.get("alert_threshold_pct", 80))
DISCORD_HOOK   = cfg.get("discord_webhook_url", "")
API_KEYS       = set(cfg.get("api_keys", []))

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

# ── Database ───────────────────────────────────────────────────────────────────
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


class Media(SQLModel, table=True):
    id:            Optional[int]       = Field(default=None, primary_key=True)
    uuid:          str                 = Field(index=True)
    filename:      str
    original_name: str
    media_type:    str                 # "video" | "image"
    extension:     str
    size_bytes:    int
    feeder_name:   str
    uploaded_at:   datetime.datetime  = Field(default_factory=datetime.datetime.utcnow)


SQLModel.metadata.create_all(engine)

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Media Gallery v3", docs_url=None, redoc_url=None)


# ── Auth ───────────────────────────────────────────────────────────────────────
def require_api_key(x_api_key: str = Header(...)):
    if API_KEYS and x_api_key not in API_KEYS:
        raise HTTPException(401, "Clé API invalide")
    return x_api_key


# ── Storage helpers ────────────────────────────────────────────────────────────
def get_total_size() -> int:
    return sum(f.stat().st_size for f in MEDIA_DIR.rglob("*") if f.is_file())


_alert_sent = False


def check_storage_alert():
    global _alert_sent
    if not DISCORD_HOOK:
        return
    total    = get_total_size()
    max_b    = MAX_TOTAL_GB * 1024 ** 3
    pct      = total / max_b * 100 if max_b else 0
    if pct >= ALERT_PCT and not _alert_sent:
        try:
            req.post(DISCORD_HOOK, json={
                "content": (
                    f"⚠️ **Media Gallery v3** — Stockage à **{pct:.0f}%**\n"
                    f"`{total/1024**3:.2f} GB / {MAX_TOTAL_GB} GB`"
                )
            }, timeout=5)
            _alert_sent = True
            log.info(f"Alerte Discord envoyée ({pct:.0f}%)")
        except Exception as e:
            log.warning(f"Alerte Discord échouée: {e}")
    elif pct < ALERT_PCT * 0.85:
        _alert_sent = False


# ── Thumbnail generation ───────────────────────────────────────────────────────
def gen_video_thumb(src: Path, dst: Path) -> bool:
    try:
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-ss", "00:00:02",
             "-vframes", "1", "-vf", "scale=480:-1", str(dst)],
            capture_output=True, timeout=30,
        )
        return dst.exists()
    except Exception as e:
        log.warning(f"ffmpeg thumb échoué pour {src.name}: {e}")
        return False


def gen_image_thumb(src: Path, dst: Path) -> bool:
    try:
        with Image.open(src) as img:
            img.thumbnail((480, 480), Image.LANCZOS)
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
            img.save(dst, "JPEG", quality=82, optimize=True)
        return True
    except Exception as e:
        log.warning(f"Thumbnail image échoué pour {src.name}: {e}")
        return False


# ── Upload ─────────────────────────────────────────────────────────────────────
@app.post("/upload")
async def upload(
    file: UploadFile = File(...),
    feeder_name: str = Header(default="unknown", alias="feeder-name"),
    _: str = Depends(require_api_key),
):
    ext = Path(file.filename).suffix.lower()
    if ext in VIDEO_EXTS:
        media_type = "video"
    elif ext in IMAGE_EXTS:
        media_type = "image"
    else:
        raise HTTPException(400, f"Extension non supportée: {ext}")

    content = await file.read()
    size    = len(content)

    if size > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"Fichier trop grand (max {MAX_FILE_MB} MB)")

    if get_total_size() + size > MAX_TOTAL_GB * 1024 ** 3:
        raise HTTPException(507, f"Quota dépassé ({MAX_TOTAL_GB} GB)")

    file_uuid = str(uuid.uuid4())
    filename  = f"{file_uuid}{ext}"
    file_path = MEDIA_DIR / filename

    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    # Thumbnail
    thumb_path = THUMB_DIR / f"{file_uuid}.jpg"
    if media_type == "video":
        gen_video_thumb(file_path, thumb_path)
    else:
        gen_image_thumb(file_path, thumb_path)

    with Session(engine) as session:
        session.add(Media(
            uuid=file_uuid,
            filename=filename,
            original_name=file.filename,
            media_type=media_type,
            extension=ext,
            size_bytes=size,
            feeder_name=feeder_name,
        ))
        session.commit()

    check_storage_alert()
    log.info(f"[{feeder_name}] Upload: {file.filename} ({size/1024/1024:.1f} MB)")
    return {"id": file_uuid, "filename": filename, "type": media_type}


# ── API ────────────────────────────────────────────────────────────────────────
@app.get("/api/media")
def list_media(
    type:     Optional[str] = Query(None),
    feeder:   Optional[str] = Query(None),
    page:     int           = Query(1, ge=1),
    per_page: int           = Query(30, ge=1, le=100),
):
    with Session(engine) as session:
        q = select(Media).order_by(col(Media.uploaded_at).desc())
        if type in ("video", "image"):
            q = q.where(Media.media_type == type)
        if feeder:
            q = q.where(Media.feeder_name == feeder)

        all_rows = session.exec(q).all()
        total    = len(all_rows)
        rows     = all_rows[(page - 1) * per_page: page * per_page]

        return {
            "total":    total,
            "page":     page,
            "per_page": per_page,
            "items": [
                {
                    "id":            m.uuid,
                    "original_name": m.original_name,
                    "type":          m.media_type,
                    "extension":     m.extension,
                    "size":          m.size_bytes,
                    "feeder":        m.feeder_name,
                    "date":          m.uploaded_at.isoformat(),
                    "url":           f"/media/{m.filename}",
                    "thumbnail":     f"/thumbnail/{m.uuid}.jpg",
                }
                for m in rows
            ],
        }


@app.get("/api/storage")
def storage_info():
    total   = get_total_size()
    max_b   = MAX_TOTAL_GB * 1024 ** 3
    return {
        "used_bytes": total,
        "used_gb":    round(total / 1024 ** 3, 2),
        "max_gb":     MAX_TOTAL_GB,
        "percent":    round(total / max_b * 100, 1) if max_b else 0,
        "alert_pct":  ALERT_PCT,
    }


@app.get("/api/feeders")
def list_feeders():
    with Session(engine) as session:
        rows = session.exec(select(Media.feeder_name)).all()
        return sorted(set(rows))


@app.delete("/api/media/{media_uuid}")
def delete_media(media_uuid: str, _: str = Depends(require_api_key)):
    with Session(engine) as session:
        media = session.exec(select(Media).where(Media.uuid == media_uuid)).first()
        if not media:
            raise HTTPException(404, "Media introuvable")
        (MEDIA_DIR / media.filename).unlink(missing_ok=True)
        (THUMB_DIR / f"{media.uuid}.jpg").unlink(missing_ok=True)
        session.delete(media)
        session.commit()
    log.info(f"Supprimé: {media_uuid}")
    return {"ok": True}


# ── Static files ───────────────────────────────────────────────────────────────
@app.get("/thumbnail/{filename}")
def get_thumbnail(filename: str):
    path = THUMB_DIR / filename
    if not path.exists():
        uuid_str = Path(filename).stem
        with Session(engine) as session:
            media = session.exec(select(Media).where(Media.uuid == uuid_str)).first()
        if media:
            src = MEDIA_DIR / media.filename
            if media.media_type == "video":
                gen_video_thumb(src, path)
            else:
                gen_image_thumb(src, path)
    if not path.exists():
        raise HTTPException(404, "Thumbnail introuvable")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/media/{filename}")
def get_media(filename: str):
    path = MEDIA_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Media introuvable")
    TYPES = {
        ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
        ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    }
    ct = TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=ct)


# Mount gallery SPA — must be last
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=cfg.get("host", "0.0.0.0"), port=int(cfg.get("port", 8000)), reload=False)
