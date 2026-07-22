"""
Notification best-effort du service Shardoss (jeu idle connecté, repo séparé
NathanGracia/shardoss) à la fin d'une partie. Fire-and-forget : jamais
awaité depuis end_game, timeout court, avale toute exception. Une panne ou
une lenteur de Shardoss ne doit JAMAIS impacter une partie Memoss en cours.
"""
import logging

import httpx

log = logging.getLogger(__name__)


async def notify_shardoss(base_url: str, webhook_key: str, payload: dict) -> None:
    if not base_url or not webhook_key:
        return  # Shardoss non configuré (dev) — no-op silencieux
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                f"{base_url}/api/webhook/game-end",
                json=payload,
                headers={"x-shardoss-key": webhook_key},
            )
            resp.raise_for_status()
    except Exception as e:
        log.warning(f"Notification Shardoss échouée (non-bloquant): {e}")


async def fetch_pinned_cards(base_url: str, webhook_key: str, account_uid: int) -> list[str]:
    """
    Media_id (jusqu'à 3) de la vitrine Shardoss d'un compte — proposés en
    bonus dans le choix de mème d'une manche (voir game_router.py::
    start_pick_round). Même garantie que notify_shardoss : best-effort,
    timeout court, avale toute exception, retombe sur liste vide — une
    panne ou une lenteur de Shardoss ne doit jamais bloquer une manche.
    """
    if not base_url or not webhook_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(
                f"{base_url}/api/pinned-cards",
                params={"account_uid": account_uid},
                headers={"x-shardoss-key": webhook_key},
            )
            resp.raise_for_status()
            return resp.json().get("pinned_media_ids", [])
    except Exception as e:
        log.warning(f"Récupération vitrine Shardoss échouée (non-bloquant): {e}")
        return []
