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
from game_router import router as game_router, init as init_game
import aiofiles
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import SQLModel, Field, Session, create_engine, select, col
from sqlalchemy import text, func
from game_models import GameAnswer
from PIL import Image
from shared_auth import SHARED_SESSION_COOKIE, verify_shared_token

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
PUBLIC_URL     = cfg.get("public_url", "").rstrip("/")
SHARED_SESSION_SECRET = cfg.get("shared_session_secret", "")

# Shardoss (jeu idle connecté, service séparé — voir NathanGracia/shardoss).
# Vide en dev par défaut : notify_shardoss() devient un no-op silencieux.
SHARDOSS_BASE_URL   = cfg.get("shardoss_base_url", "").rstrip("/")
SHARDOSS_WEBHOOK_KEY = cfg.get("shardoss_webhook_key", "")

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
    tag:           str                 = Field(default="todo")  # "osef" | "cinema" | "todo"
    uploaded_at:   datetime.datetime  = Field(default_factory=datetime.datetime.utcnow)
    duration_seconds: Optional[float] = Field(default=None)  # vidéos uniquement — voir gen_video_duration


SQLModel.metadata.create_all(engine)
init_game(engine, Media, SHARED_SESSION_SECRET, SHARDOSS_BASE_URL, SHARDOSS_WEBHOOK_KEY)

# Migration : ajoute la colonne tag si elle n'existe pas encore (DB existante)
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE media ADD COLUMN tag VARCHAR DEFAULT 'osef'"))
        _conn.execute(text("UPDATE media SET tag = 'todo' WHERE tag IS NULL"))
        _conn.commit()
        log.info("Migration : colonne 'tag' ajoutée.")
    except Exception:
        pass  # Colonne déjà présente

# Migration : ajoute la colonne played_at à game_rounds (regroupement par partie)
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE game_rounds ADD COLUMN played_at DATETIME"))
        _conn.commit()
        log.info("Migration : colonne 'played_at' ajoutée à game_rounds.")
    except Exception:
        pass  # Colonne déjà présente

# Migration : ajoute account_uid (lien vers le compte cooloss du joueur)
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE game_players ADD COLUMN account_uid INTEGER"))
        _conn.execute(text("ALTER TABLE game_answers ADD COLUMN account_uid INTEGER"))
        _conn.commit()
        log.info("Migration : colonne 'account_uid' ajoutée à game_players/game_answers.")
    except Exception:
        pass  # Colonne déjà présente

# Migration : ajoute duration_seconds (consommé par Shardoss, voir /api/shardoss/stats)
with engine.connect() as _conn:
    try:
        _conn.execute(text("ALTER TABLE media ADD COLUMN duration_seconds FLOAT"))
        _conn.commit()
        log.info("Migration : colonne 'duration_seconds' ajoutée à media.")
    except Exception:
        pass  # Colonne déjà présente

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Media Gallery v3", docs_url=None, redoc_url=None)

# Shardoss (server/static/app.js) fetch() les métadonnées média cross-origin
# (GET /api/media/{uuid}) pour construire l'URL de la vidéo — sans CORS le
# navigateur bloque silencieusement la lecture de la réponse, meta reste
# null côté client et aucune vidéo ne se charge jamais (bug constaté en
# prod). Scope à l'origine Shardoss uniquement, endpoint public/sans
# credentials donc pas de risque à l'élargir un peu, mais pas de wildcard
# non plus par cohérence avec le reste des configs CORS de ces apps.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shardoss.nathangracia.com"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Auth ───────────────────────────────────────────────────────────────────────
def require_api_key(x_api_key: str = Header(...)):
    """Réservé au feeder .exe — clé API brute, inchangé."""
    if API_KEYS and x_api_key not in API_KEYS:
        raise HTTPException(401, "Clé API invalide")
    return x_api_key


def get_shared_claims(request: Request) -> Optional[dict]:
    token = request.cookies.get(SHARED_SESSION_COOKIE)
    return verify_shared_token(token, SHARED_SESSION_SECRET)


def require_admin_or_api_key(request: Request, x_api_key: Optional[str] = Header(default=None)):
    """
    Gate des actions admin déclenchées depuis le navigateur (suppression,
    édition de tag, crop). Accepte SOIT la clé API historique (compat,
    surtout utile si jamais appelé hors navigateur), SOIT une session
    cooloss valide avec isAdmin=true — c'est ce dernier chemin que l'UI
    utilise désormais (voir static/app.js, plus de prompt() de mot de passe).
    """
    if x_api_key and API_KEYS and x_api_key in API_KEYS:
        return
    claims = get_shared_claims(request)
    if claims and claims.get("isAdmin"):
        return
    raise HTTPException(401, "Non autorisé")


@app.get("/api/whoami")
def whoami(request: Request):
    claims = get_shared_claims(request)
    if not claims:
        return {"loggedIn": False}
    return {
        "loggedIn": True,
        "username": claims["username"],
        "displayName": claims.get("displayName"),
        "isAdmin": bool(claims.get("isAdmin")),
        "isHabitue": bool(claims.get("isHabitue")),
        "avatarFile": claims.get("avatarFile"),
        "volume": claims.get("volume", 0.15),
    }


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


def gen_video_duration(src: Path) -> Optional[float]:
    """Consommé par Shardoss (voir /api/shardoss/stats) pour le rythme d'affichage des gains — jamais pour le calcul du taux économique lui-même."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
            capture_output=True, timeout=15, text=True,
        )
        return float(r.stdout.strip())
    except Exception as e:
        log.warning(f"ffprobe duration échoué pour {src.name}: {e}")
        return None


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

    # Thumbnail + durée (vidéo uniquement)
    thumb_path = THUMB_DIR / f"{file_uuid}.jpg"
    duration: Optional[float] = None
    if media_type == "video":
        gen_video_thumb(file_path, thumb_path)
        duration = gen_video_duration(file_path)
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
            duration_seconds=duration,
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
    tag:      Optional[str] = Query(None),
    page:     int           = Query(1, ge=1),
    per_page: int           = Query(30, ge=1, le=10000),
):
    with Session(engine) as session:
        q = select(Media).order_by(col(Media.uploaded_at).desc())
        if type in ("video", "image"):
            q = q.where(Media.media_type == type)
        if feeder:
            q = q.where(Media.feeder_name == feeder)
        if tag in ("osef", "cinema", "todo"):
            q = q.where(Media.tag == tag)

        all_rows = session.exec(q).all()

        # Tri par nombre de réponses Memoss (décroissant), puis par date
        if all_rows:
            uuids = [m.uuid for m in all_rows]
            count_rows = session.exec(
                select(GameAnswer.media_uuid, func.count(GameAnswer.id).label("cnt"))
                .where(GameAnswer.media_uuid.in_(uuids))
                .group_by(GameAnswer.media_uuid)
            ).all()
            answer_counts = {r.media_uuid: r.cnt for r in count_rows}
            all_rows = sorted(all_rows, key=lambda m: (-answer_counts.get(m.uuid, 0), -m.uploaded_at.timestamp()))

        total = len(all_rows)
        rows  = all_rows[(page - 1) * per_page: page * per_page]

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
                    "tag":           m.tag or "osef",
                    "date":          m.uploaded_at.isoformat(),
                    "url":           f"/media/{m.filename}",
                    "thumbnail":     f"/thumbnail/{m.uuid}.jpg",
                }
                for m in rows
            ],
        }


@app.get("/api/media/{media_uuid}")
def get_media_meta(media_uuid: str):
    with Session(engine) as session:
        m = session.exec(select(Media).where(Media.uuid == media_uuid)).first()
        if not m:
            raise HTTPException(404, "Media introuvable")
        return {
            "id":            m.uuid,
            "original_name": m.original_name,
            "type":          m.media_type,
            "extension":     m.extension,
            "size":          m.size_bytes,
            "feeder":        m.feeder_name,
            "tag":           m.tag or "todo",
            "date":          m.uploaded_at.isoformat(),
            "url":           f"/media/{m.filename}",
            "thumbnail":     f"/thumbnail/{m.uuid}.jpg",
        }


@app.get("/api/shardoss/stats")
def shardoss_stats(_: str = Depends(require_api_key)):
    """
    Population complète des médias éligibles au jeu (tag=cinema, vidéo),
    y compris ceux à 0 vue — Shardoss a besoin de la galerie entière pour
    calculer des percentiles de popularité/qualité corrects, pas seulement
    des médias déjà joués. Gated par la même clé API que le feeder, avec une
    entrée dédiée à Shardoss dans api_keys: (voir config.yaml.example).
    """
    with Session(engine) as session:
        media_rows = session.exec(
            select(Media).where(Media.tag == "cinema", Media.media_type == "video")
        ).all()
        uuids = [m.uuid for m in media_rows]

        agg_map: dict[str, tuple[int, int, int]] = {}
        if uuids:
            agg_rows = session.exec(
                select(
                    GameAnswer.media_uuid,
                    func.count(GameAnswer.id).label("play_count"),
                    func.sum(GameAnswer.total_stars).label("stars_sum"),
                    func.sum(GameAnswer.vote_count).label("votes_sum"),
                )
                .where(GameAnswer.media_uuid.in_(uuids))
                .group_by(GameAnswer.media_uuid)
            ).all()
            agg_map = {r.media_uuid: (r.play_count, r.stars_sum or 0, r.votes_sum or 0) for r in agg_rows}

        return [
            {
                "uuid": m.uuid,
                "duration_seconds": m.duration_seconds,
                "play_count": agg_map.get(m.uuid, (0, 0, 0))[0],
                "total_stars_sum": agg_map.get(m.uuid, (0, 0, 0))[1],
                "vote_count_sum": agg_map.get(m.uuid, (0, 0, 0))[2],
            }
            for m in media_rows
        ]


@app.get("/api/shardoss/legend/{media_uuid}")
def shardoss_legend(media_uuid: str, _: str = Depends(require_api_key)):
    """
    Meilleure légende (réponse du jeu de mèmes) pour un média donné —
    classée par note moyenne (total_stars/vote_count) puis total_stars,
    même ordre que le classement affiché en jeu (voir game_router.py).
    GameAnswer n'a pas de statut de modération : seul vote_count > 0 est
    filtré, pour ne jamais remonter une réponse jamais notée. Renvoie null
    si aucune réponse notée n'existe pour ce média. Même gate que
    /api/shardoss/stats (clé API dédiée à Shardoss dans api_keys:).
    """
    with Session(engine) as session:
        rows = session.exec(
            select(GameAnswer).where(
                GameAnswer.media_uuid == media_uuid,
                GameAnswer.vote_count > 0,
            )
        ).all()
        if not rows:
            return None
        best = max(rows, key=lambda r: (r.total_stars / r.vote_count, r.total_stars))
        return {
            "text": best.text,
            "pseudo": best.player_pseudo,
            "avg": round(best.total_stars / best.vote_count, 2),
            "vote_count": best.vote_count,
        }


@app.patch("/api/media/{media_uuid}/tag")
def update_tag(media_uuid: str, tag: str = Query(...), _: None = Depends(require_admin_or_api_key)):
    if tag not in ("osef", "cinema", "todo"):
        raise HTTPException(400, "Tag invalide (osef | cinema | todo)")
    with Session(engine) as session:
        media = session.exec(select(Media).where(Media.uuid == media_uuid)).first()
        if not media:
            raise HTTPException(404, "Media introuvable")
        media.tag = tag
        session.add(media)
        session.commit()
    return {"ok": True, "tag": tag}


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


@app.post("/api/media/{media_uuid}/crop")
def crop_media(
    media_uuid: str,
    top_pct:    float = Query(0, ge=0, lt=50),
    bottom_pct: float = Query(0, ge=0, lt=50),
    _: None = Depends(require_admin_or_api_key),
):
    if top_pct + bottom_pct == 0:
        raise HTTPException(400, "Aucun rognage demandé")

    with Session(engine) as session:
        media = session.exec(select(Media).where(Media.uuid == media_uuid)).first()
        if not media:
            raise HTTPException(404, "Media introuvable")
        if media.media_type != "video":
            raise HTTPException(400, "Crop disponible uniquement pour les vidéos")
        src_filename    = media.filename
        src_original    = media.original_name
        src_extension   = media.extension
        src_feeder      = media.feeder_name

    src_path = MEDIA_DIR / src_filename

    # Récupérer les dimensions via ffprobe
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(src_path)],
        capture_output=True, text=True, timeout=15,
    )
    if probe.returncode != 0 or not probe.stdout.strip():
        raise HTTPException(500, "Impossible de lire les dimensions de la vidéo")
    try:
        w, h = map(int, probe.stdout.strip().split(","))
    except ValueError:
        raise HTTPException(500, "Dimensions invalides")

    top_px    = round(h * top_pct    / 100)
    bottom_px = round(h * bottom_pct / 100)
    new_h     = h - top_px - bottom_px
    if new_h % 2 != 0:
        new_h -= 1
    if new_h <= 0:
        raise HTTPException(400, "Zone de crop invalide")

    # Nouveau fichier indépendant
    new_uuid     = str(uuid.uuid4())
    new_filename = f"{new_uuid}{src_extension}"
    new_path     = MEDIA_DIR / new_filename

    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src_path),
         "-vf", f"crop={w}:{new_h}:0:{top_px}",
         "-c:a", "copy", str(new_path)],
        capture_output=True, timeout=300,
    )
    if r.returncode != 0 or not new_path.exists():
        new_path.unlink(missing_ok=True)
        raise HTTPException(500, f"FFmpeg échoué: {r.stderr[-300:].decode(errors='replace')}")

    new_original = Path(src_original).stem + f"_crop{src_extension}"
    with Session(engine) as session:
        session.add(Media(
            uuid          = new_uuid,
            filename      = new_filename,
            original_name = new_original,
            media_type    = "video",
            extension     = src_extension,
            size_bytes    = new_path.stat().st_size,
            feeder_name   = src_feeder,
            tag           = "osef",
        ))
        session.commit()

    thumb_path = THUMB_DIR / f"{new_uuid}.jpg"
    gen_video_thumb(new_path, thumb_path)

    log.info(f"Crop: {media_uuid} → {new_uuid} top={top_pct}% bottom={bottom_pct}%")
    return {"ok": True, "id": new_uuid}


@app.delete("/api/media/{media_uuid}")
def delete_media(media_uuid: str, _: None = Depends(require_admin_or_api_key)):
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


app.include_router(game_router)

@app.get("/timeline")
async def timeline_page():
    return FileResponse("static/timeline.html")

# Static game SPA — mounté sur /game (alias historique) ET servi comme landing
# page sur "/" (voir plus bas) : le jeu est la page d'accueil du site depuis
# juillet 2026, la galerie a déménagé sur /gallery.
app.mount("/game", StaticFiles(directory="static/game", html=True), name="game-static")

@app.get("/")
async def landing_page():
    return FileResponse("static/game/index.html")

# ── Open Graph preview pour les liens partagés (?m=UUID&l=ID) ─────────────────
@app.get("/gallery")
async def gallery_page(request: Request, m: Optional[str] = None, l: Optional[str] = None):
    if not m:
        return FileResponse("static/index.html")

    with Session(engine) as s:
        media = s.exec(select(Media).where(Media.uuid == m)).first()
    if not media:
        return FileResponse("static/index.html")

    base      = PUBLIC_URL or str(request.base_url).rstrip("/")
    page_url  = f"{base}/gallery?m={m}" + (f"&l={l}" if l else "")
    thumb_url = f"{base}/thumbnail/{media.uuid}.jpg"
    video_url = f"{base}/media/{media.filename}"
    is_video  = media.media_type == "video"

    # Par défaut (pas de légende)
    title = "Memoss"
    desc  = "Découvrez ce mème"

    if l:
        try:
            with Session(engine) as s:
                cap = s.exec(select(GameAnswer).where(GameAnswer.id == int(l))).first()
            if cap:
                title = cap.text           # légende = titre (bleu sur Discord)
                desc  = cap.player_pseudo  # auteur = description (blanc)
        except Exception:
            pass

    def xa(v):
        return v.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")

    og_lines = [
        f'<meta property="og:title" content="{xa(title)}">',
        f'<meta property="og:description" content="{xa(desc)}">',
        f'<meta property="og:image" content="{xa(thumb_url)}">',
        f'<meta property="og:url" content="{xa(page_url)}">',
        f'<meta property="og:type" content="{"video.other" if is_video else "website"}">',
        f'<meta property="og:site_name" content="Memoss">',
        f'<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{xa(title)}">',
        f'<meta name="twitter:description" content="{xa(desc)}">',
        f'<meta name="twitter:image" content="{xa(thumb_url)}">',
    ]
    if is_video:
        og_lines += [
            f'<meta property="og:video" content="{xa(video_url)}">',
            f'<meta property="og:video:type" content="video/mp4">',
            f'<meta property="og:video:secure_url" content="{xa(video_url)}">',
        ]
    og = "\n  ".join(og_lines)

    page = Path("static/index.html").read_text(encoding="utf-8")
    page = page.replace("</head>", f"  {og}\n</head>", 1)
    return HTMLResponse(page)

# Mount gallery SPA — must be last
app.mount("/", StaticFiles(directory="static", html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=cfg.get("host", "0.0.0.0"), port=int(cfg.get("port", 8000)))
