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
