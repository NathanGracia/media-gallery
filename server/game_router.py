"""
Router FastAPI pour le jeu de mèmes — WebSocket + REST.
Phase 1 : tous les rounds de soumission d'abord.
Phase 2 : tous les rounds de révélation / vote ensuite.
"""
import asyncio
import datetime
import random
import string
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from sqlmodel import Session, select, SQLModel

from game_models import GameRoom, GamePlayer, GameRound, GameAnswer, GameVote

log     = logging.getLogger(__name__)
router  = APIRouter()
_engine = None
_Media  = None

TOTAL_ROUNDS = 3


def init(engine, MediaModel):
    global _engine, _Media
    _engine = engine
    _Media  = MediaModel
    SQLModel.metadata.create_all(_engine)
    log.info("Game router initialisé.")


# ── Connection Manager ─────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.rooms: dict[str, dict[int, WebSocket]] = {}

    async def connect(self, code: str, player_id: int, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(code, {})[player_id] = ws

    def disconnect(self, code: str, player_id: int):
        if code in self.rooms:
            self.rooms[code].pop(player_id, None)

    async def broadcast(self, code: str, msg: dict):
        for ws in list(self.rooms.get(code, {}).values()):
            try:
                await ws.send_json(msg)
            except Exception:
                pass

    async def send_to(self, code: str, player_id: int, msg: dict):
        ws = self.rooms.get(code, {}).get(player_id)
        if ws:
            try:
                await ws.send_json(msg)
            except Exception:
                pass


manager     = ConnectionManager()
game_states: dict[str, dict] = {}


# ── Helpers ────────────────────────────────────────────────────────────────────
def gen_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def get_random_memes(n: int = 3) -> list[dict]:
    with Session(_engine) as s:
        all_memes = s.exec(
            select(_Media)
            .where(_Media.tag == "cinema")
            .where(_Media.media_type == "video")
        ).all()
    if not all_memes:
        return []
    chosen = random.sample(all_memes, min(n, len(all_memes)))
    return [
        {"uuid": m.uuid, "url": f"/media/{m.filename}", "thumb": f"/thumbnail/{m.uuid}.jpg"}
        for m in chosen
    ]


def meme_info(uuid: str) -> dict:
    with Session(_engine) as s:
        m = s.exec(select(_Media).where(_Media.uuid == uuid)).first()
    if not m:
        return {"uuid": uuid, "url": "", "thumb": ""}
    return {"uuid": m.uuid, "url": f"/media/{m.filename}", "thumb": f"/thumbnail/{m.uuid}.jpg"}


def players_list(state: dict) -> list[dict]:
    return [
        {"id": pid, "pseudo": p["pseudo"], "score": p["score"], "connected": p["connected"]}
        for pid, p in state["players"].items()
    ]


def new_state(db_room_id: int, host_id: int, host_pseudo: str) -> dict:
    return {
        "status":          "lobby",
        "pick_round":      0,      # index du round de soumission en cours (0-based)
        "reveal_round":    0,      # index du round de révélation en cours (0-based)
        "host_id":         host_id,
        "players":         {host_id: {"pseudo": host_pseudo, "score": 0, "connected": False}},
        "player_memes":    {},     # pid -> [{uuid,url,thumb}] pour le round courant
        "player_drafts":   {},     # pid -> {media_uuid, text} — brouillon en cours de frappe
        "submissions":     {},     # pid -> {media_uuid, text} pour le round courant
        "all_submissions": {},     # pick_round_idx -> {pid -> {media_uuid, text}}
        "timer_task":      None,
        "reveal_queue":    [],
        "reveal_index":    0,
        "current_votes":   {},
        "all_answers":     [],
        "db_room_id":      db_room_id,
    }


# ── REST ───────────────────────────────────────────────────────────────────────
@router.post("/game/api/rooms")
async def create_room(body: dict):
    pseudo = body.get("pseudo", "").strip()[:20]
    if not pseudo:
        raise HTTPException(400, "Pseudo requis")

    code = gen_code()
    while code in game_states:
        code = gen_code()

    with Session(_engine) as s:
        room = GameRoom(code=code, host_pseudo=pseudo)
        s.add(room); s.commit(); s.refresh(room)
        player = GamePlayer(room_id=room.id, pseudo=pseudo)
        s.add(player); s.commit(); s.refresh(player)
        db_room_id = room.id
        player_id  = player.id

    game_states[code] = new_state(db_room_id, player_id, pseudo)
    return {"room_code": code, "player_id": player_id}


@router.post("/game/api/rooms/{code}/join")
async def join_room(code: str, body: dict):
    code  = code.upper()
    state = game_states.get(code)
    if not state:
        raise HTTPException(404, "Room introuvable")
    if state["status"] != "lobby":
        raise HTTPException(400, "Partie déjà en cours")
    if len(state["players"]) >= 8:
        raise HTTPException(400, "Room pleine (8 joueurs max)")

    pseudo = body.get("pseudo", "").strip()[:20]
    if not pseudo:
        raise HTTPException(400, "Pseudo requis")

    with Session(_engine) as s:
        player = GamePlayer(room_id=state["db_room_id"], pseudo=pseudo)
        s.add(player); s.commit(); s.refresh(player)
        player_id = player.id

    state["players"][player_id] = {"pseudo": pseudo, "score": 0, "connected": False}
    return {"room_code": code, "player_id": player_id, "players": players_list(state)}


@router.get("/game/api/timeline")
async def get_timeline(days: int = 7):
    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    with Session(_engine) as s:
        rows = s.exec(
            select(
                GameAnswer.id,
                GameAnswer.player_pseudo,
                GameAnswer.media_uuid,
                GameAnswer.text,
                GameAnswer.total_stars,
                GameAnswer.vote_count,
                GameRoom.created_at,
            )
            .join(GameRound, GameAnswer.round_id == GameRound.id)
            .join(GameRoom, GameRound.room_id == GameRoom.id)
            .where(GameAnswer.text != "")
            .where(GameRoom.created_at >= since)
            .order_by(GameRoom.created_at.desc(), GameAnswer.id.asc())
        ).all()

        uuids   = list({r.media_uuid for r in rows})
        medias  = s.exec(select(_Media).where(_Media.uuid.in_(uuids))).all() if uuids else []
        url_map = {m.uuid: f"/media/{m.filename}" for m in medias}

        return [
            {
                "pseudo":      r.player_pseudo,
                "text":        r.text,
                "total_stars": r.total_stars,
                "vote_count":  r.vote_count,
                "avg":         round(r.total_stars / r.vote_count, 1) if r.vote_count else 0,
                "media_uuid":  r.media_uuid,
                "url":         url_map.get(r.media_uuid),
                "thumb":       f"/thumbnail/{r.media_uuid}.jpg",
                "game_date":   r.created_at.isoformat(),
            }
            for r in rows
        ]


@router.get("/game/api/history/{media_uuid}")
async def get_history(media_uuid: str):
    with Session(_engine) as s:
        answers = s.exec(
            select(GameAnswer)
            .where(GameAnswer.media_uuid == media_uuid)
            .where(GameAnswer.text != "")
            .order_by(GameAnswer.total_stars.desc())
        ).all()
        return [
            {
                "pseudo":      a.player_pseudo,
                "text":        a.text,
                "total_stars": a.total_stars,
                "vote_count":  a.vote_count,
                "avg":         round(a.total_stars / a.vote_count, 1) if a.vote_count else 0,
            }
            for a in answers
        ]


# ── WebSocket ──────────────────────────────────────────────────────────────────
@router.websocket("/game/ws/{code}/{player_id}")
async def game_ws(websocket: WebSocket, code: str, player_id: int):
    code  = code.upper()
    state = game_states.get(code)
    if not state or player_id not in state["players"]:
        await websocket.close(code=4004)
        return

    await manager.connect(code, player_id, websocket)
    state["players"][player_id]["connected"] = True

    await websocket.send_json({
        "type":      "connected",
        "player_id": player_id,
        "is_host":   player_id == state["host_id"],
        "players":   players_list(state),
        "status":    state["status"],
        "round":     state["pick_round"],
    })
    await manager.broadcast(code, {"type": "room_update", "players": players_list(state)})

    async def heartbeat():
        while True:
            await asyncio.sleep(30)
            try:
                await websocket.send_json({"type": "ping"})
            except Exception:
                break

    hb_task = asyncio.create_task(heartbeat())
    try:
        while True:
            data  = await websocket.receive_json()
            event = data.get("type")

            if event == "pong":
                pass

            elif event == "start_game":
                if player_id == state["host_id"] and state["status"] == "lobby":
                    await start_game(code)

            elif event == "draft_answer":
                if state["status"] == "picking" and player_id not in state["submissions"]:
                    media_uuid = data.get("media_uuid", "")
                    text       = data.get("text", "")[:100]
                    state["player_drafts"][player_id] = {"media_uuid": media_uuid, "text": text}

            elif event == "submit_answer":
                if state["status"] == "picking" and player_id not in state["submissions"]:
                    await handle_submit(code, player_id, data)

            elif event == "submit_vote":
                if state["status"] == "revealing" and player_id not in state["current_votes"]:
                    await handle_vote(code, player_id, data)

    except WebSocketDisconnect:
        manager.disconnect(code, player_id)
        state["players"][player_id]["connected"] = False
        await manager.broadcast(code, {"type": "room_update", "players": players_list(state)})
        if state["status"] == "picking":
            await check_all_submitted(code)
        elif state["status"] == "revealing":
            await check_all_voted(code)
    finally:
        hb_task.cancel()


# ── Phase 1 : Soumission ───────────────────────────────────────────────────────
async def start_game(code: str):
    state = game_states[code]
    state["status"]     = "picking"
    state["pick_round"] = 0
    await start_pick_round(code)


async def start_pick_round(code: str):
    state = game_states[code]
    n = state["pick_round"]
    state["submissions"]   = {}
    state["player_memes"]  = {}
    state["player_drafts"] = {}

    for pid in state["players"]:
        memes = get_random_memes(5)
        state["player_memes"][pid] = memes
        await manager.send_to(code, pid, {
            "type":         "round_start",
            "round":        n + 1,
            "total_rounds": TOTAL_ROUNDS,
            "memes":        memes,
        })

    if state["timer_task"]:
        state["timer_task"].cancel()
    state["timer_task"] = asyncio.create_task(round_timer(code, n))


async def round_timer(code: str, pick_round: int):
    for remaining in range(119, -1, -1):
        await asyncio.sleep(1)
        st = game_states.get(code)
        if not st or st["pick_round"] != pick_round or st["status"] != "picking":
            return
        await manager.broadcast(code, {"type": "timer_tick", "remaining": remaining})
    st = game_states.get(code)
    if st and st["pick_round"] == pick_round and st["status"] == "picking":
        await auto_submit_missing(code)


async def auto_submit_missing(code: str):
    state = game_states[code]
    for pid in list(state["players"]):
        if pid not in state["submissions"]:
            draft = state["player_drafts"].get(pid)
            if draft and draft.get("media_uuid"):
                state["submissions"][pid] = {"media_uuid": draft["media_uuid"], "text": draft.get("text", "")}
            else:
                memes  = state["player_memes"].get(pid, [])
                chosen = random.choice(memes) if memes else {"uuid": ""}
                state["submissions"][pid] = {"media_uuid": chosen["uuid"], "text": draft.get("text", "") if draft else ""}
    await advance_picking(code)


async def handle_submit(code: str, player_id: int, data: dict):
    state      = game_states[code]
    media_uuid = data.get("media_uuid", "")
    text       = data.get("text", "")[:100]

    offered = [m["uuid"] for m in state["player_memes"].get(player_id, [])]
    if media_uuid not in offered:
        return

    state["submissions"][player_id] = {"media_uuid": media_uuid, "text": text}

    connected = [pid for pid, p in state["players"].items() if p["connected"]]
    submitted = sum(1 for pid in connected if pid in state["submissions"])
    await manager.broadcast(code, {
        "type":      "submit_progress",
        "submitted": submitted,
        "total":     len(connected),
        "round":     state["pick_round"] + 1,
    })
    await check_all_submitted(code)


async def check_all_submitted(code: str):
    state = game_states[code]
    if state["status"] != "picking":
        return
    connected = [pid for pid, p in state["players"].items() if p["connected"]]
    if all(pid in state["submissions"] for pid in connected):
        if state["timer_task"]:
            state["timer_task"].cancel()
            state["timer_task"] = None
        await advance_picking(code)


async def advance_picking(code: str):
    state = game_states[code]
    n = state["pick_round"]

    # Sauvegarde les soumissions de ce round
    state["all_submissions"][n] = dict(state["submissions"])

    if n < TOTAL_ROUNDS - 1:
        # Prochain round de soumission
        state["pick_round"] += 1
        await start_pick_round(code)
    else:
        # Toutes les soumissions collectées → phase de révélation
        state["reveal_round"] = 0
        await start_reveal_phase(code)


# ── Phase 2 : Révélation ───────────────────────────────────────────────────────
async def start_reveal_phase(code: str):
    state = game_states[code]
    state["status"] = "revealing"
    n = state["reveal_round"]

    subs = state["all_submissions"].get(n, {})
    queue = []
    for pid, sub in subs.items():
        if not sub["media_uuid"]:
            continue
        queue.append({
            "player_id":  pid,
            "pseudo":     state["players"][pid]["pseudo"],
            "media_uuid": sub["media_uuid"],
            "text":       sub["text"],
            "round_num":  n,
        })
    random.shuffle(queue)
    state["reveal_queue"]  = queue
    state["reveal_index"]  = 0
    state["current_votes"] = {}

    await manager.broadcast(code, {
        "type":         "reveal_phase_start",
        "reveal_round": n + 1,
        "total_rounds": TOTAL_ROUNDS,
    })

    await reveal_next(code)


async def reveal_next(code: str):
    state = game_states[code]
    idx   = state["reveal_index"]

    if idx >= len(state["reveal_queue"]):
        await end_reveal_round(code)
        return

    item = state["reveal_queue"][idx]
    state["current_votes"] = {}

    info = meme_info(item["media_uuid"])

    await manager.broadcast(code, {
        "type":          "reveal_meme",
        "reveal_index":  idx + 1,
        "total_reveals": len(state["reveal_queue"]),
        "reveal_round":  state["reveal_round"] + 1,
        "total_rounds":  TOTAL_ROUNDS,
        "player_id":     item["player_id"],
        "pseudo":        item["pseudo"],
        "media_uuid":    item["media_uuid"],
        "media_url":     info["url"],
        "thumb":         info["thumb"],
        "text":          item["text"],
    })


async def handle_vote(code: str, player_id: int, data: dict):
    state = game_states[code]
    if state["status"] != "revealing":
        return
    item = state["reveal_queue"][state["reveal_index"]]
    if player_id == item["player_id"]:
        return

    stars = max(0, min(100, int(data.get("stars", 50))))
    state["current_votes"][player_id] = stars
    await check_all_voted(code)


async def check_all_voted(code: str):
    state = game_states[code]
    if state["status"] != "revealing":
        return

    idx  = state["reveal_index"]
    item = state["reveal_queue"][idx]

    eligible = [
        pid for pid, p in state["players"].items()
        if p["connected"] and pid != item["player_id"]
    ]

    if eligible and not all(pid in state["current_votes"] for pid in eligible):
        return

    total_stars = sum(state["current_votes"].values())
    vote_count  = len(state["current_votes"])
    avg_score   = round(total_stars / vote_count) if vote_count else 0

    state["players"][item["player_id"]]["score"] += avg_score

    state["all_answers"].append({
        "round_num":    item["round_num"],
        "player_id":    item["player_id"],
        "pseudo":       item["pseudo"],
        "media_uuid":   item["media_uuid"],
        "text":         item["text"],
        "reveal_order": idx,
        "total_stars":  total_stars,
        "vote_count":   vote_count,
        "votes":        dict(state["current_votes"]),
    })

    await manager.broadcast(code, {
        "type":         "reveal_result",
        "reveal_index": idx + 1,
        "player_id":    item["player_id"],
        "pseudo":       item["pseudo"],
        "total_stars":  total_stars,
        "vote_count":   vote_count,
        "players":      players_list(state),
    })

    await asyncio.sleep(3)
    state["reveal_index"]  += 1
    state["current_votes"]  = {}
    await reveal_next(code)


async def end_reveal_round(code: str):
    state = game_states[code]
    n     = state["reveal_round"]

    await manager.broadcast(code, {
        "type":         "round_end",
        "reveal_round": n + 1,
        "total_rounds": TOTAL_ROUNDS,
        "players":      players_list(state),
    })

    await asyncio.sleep(1)

    if n >= TOTAL_ROUNDS - 1:
        await end_game(code)
    else:
        state["reveal_round"] += 1
        await start_reveal_phase(code)


async def end_game(code: str):
    state          = game_states[code]
    state["status"] = "finished"

    sorted_players = sorted(players_list(state), key=lambda p: p["score"], reverse=True)
    await manager.broadcast(code, {
        "type":    "game_end",
        "players": sorted_players,
        "winner":  sorted_players[0] if sorted_players else None,
    })

    await _save_to_db(code)

    # Retour au lobby après 10s pour une nouvelle partie
    await asyncio.sleep(10)

    for pid in state["players"]:
        state["players"][pid]["score"] = 0
    state["status"]          = "lobby"
    state["pick_round"]      = 0
    state["reveal_round"]    = 0
    state["submissions"]     = {}
    state["all_submissions"] = {}
    state["reveal_queue"]    = []
    state["reveal_index"]    = 0
    state["current_votes"]   = {}
    state["all_answers"]     = []

    await manager.broadcast(code, {
        "type":    "back_to_lobby",
        "players": players_list(state),
    })


async def _save_to_db(code: str):
    state = game_states[code]
    with Session(_engine) as s:
        room = s.exec(select(GameRoom).where(GameRoom.id == state["db_room_id"])).first()
        if room:
            room.status = "finished"
            s.add(room)

        for pid, p in state["players"].items():
            player = s.exec(select(GamePlayer).where(GamePlayer.id == pid)).first()
            if player:
                player.score = p["score"]
                s.add(player)
        s.commit()

        round_cache: dict[int, int] = {}

        for ans in state["all_answers"]:
            rnum = ans["round_num"]
            if rnum not in round_cache:
                gr = GameRound(room_id=state["db_room_id"], round_num=rnum)
                s.add(gr); s.commit(); s.refresh(gr)
                round_cache[rnum] = gr.id

            ga = GameAnswer(
                round_id      = round_cache[rnum],
                player_id     = ans["player_id"],
                player_pseudo = ans["pseudo"],
                media_uuid    = ans["media_uuid"],
                text          = ans["text"],
                reveal_order  = ans["reveal_order"],
                total_stars   = ans["total_stars"],
                vote_count    = ans["vote_count"],
            )
            s.add(ga); s.commit(); s.refresh(ga)

            for voter_pid, stars in ans["votes"].items():
                s.add(GameVote(answer_id=ga.id, voter_player_id=voter_pid, stars=stars))
        s.commit()

    log.info(f"Partie {code} sauvegardée.")
