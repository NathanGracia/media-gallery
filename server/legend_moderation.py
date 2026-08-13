"""
Classification IA (Gemini) des légendes du jeu Memoss en "public" / "private".

Critère "public" (voir CHUNK_SIZE / PROMPT_INSTRUCTIONS ci-dessous) : la
légende doit être à la fois compréhensible par n'importe qui (pas une private
joke qui ne fait sens que dans le contexte de la partie/du groupe) ET pas
trash/NSFW. Si l'un des deux critères échoue, elle reste "private".

Le résultat est indicatif : `visibility` n'est mis à jour par
POST /game/api/legends/classify que pour les légendes pas encore `reviewed`
(voir game_router.py) — une décision manuelle n'est jamais écrasée par un
nouveau passage de classification.
"""
import asyncio
import json
import logging

import httpx

log = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
CHUNK_SIZE = 25   # légendes par appel Gemini — réduit le nombre de requêtes, pas le coût en tokens
TIMEOUT_S  = 20.0
MAX_CONCURRENT_CHUNKS = 4   # lots en parallèle — un lot de 200 (8 appels) séquentiels dépassait la minute

PROMPT_INSTRUCTIONS = """Tu es un modérateur de contenu pour Memoss, un jeu où des joueurs inventent des légendes (captions) pour des mèmes, en français.

Ton rôle : classer chaque légende en "public" ou "private" selon deux critères. Les DEUX doivent être vrais pour "public" :

1. COMPRÉHENSIBLE PAR N'IMPORTE QUI : la légende doit faire sens pour quelqu'un qui ne connaît pas les joueurs, ne joue pas au jeu, et n'a pas vu la partie. Une private joke qui ne fonctionne que pour un groupe précis (prénom, surnom, référence à un événement du groupe, blague de Discord...) est "private", même si elle est parfaitement inoffensive.
2. PAS TRASH / PAS NSFW : aucune vulgarité, aucun contenu sexuel explicite ou sous-entendu, aucune violence graphique, aucune insulte ciblée. Une légende peut être drôle, ironique ou absurde sans être NSFW — juge comme un public généraliste, pas comme un groupe d'amis entre eux.

Si l'un des deux critères échoue, classe en "private".

Exemples de calibration :
- "Moi le lundi matin en sortant du lit" → public (compréhensible par tous, inoffensif)
- "Kevin qui recommence encore" → private (private joke, "Kevin" ne veut rien dire hors contexte)
- "asdkjfh mdr" → private (incompréhensible, aucun sens)
- "elle a plus de vie que ta mère" → private (insulte)
- "quand le prof demande qui n'a pas fait ses devoirs" → public
- "j'aimerais bien la finir ce soir si tu vois ce que je veux dire" → private (sous-entendu sexuel)"""


def _build_prompt(items: list[dict]) -> str:
    numbered = "\n".join(f'{item["id"]}: "{item["text"]}"' for item in items)
    return f"""{PROMPT_INSTRUCTIONS}

Légendes à classifier (id: "texte") :
{numbered}

Réponds UNIQUEMENT avec un tableau JSON, un objet par légende, dans le même ordre, format exact :
[{{"id": <id exact tel que fourni>, "label": "public" ou "private", "reason": "<raison en 6 mots maximum, en français>"}}]"""


async def classify_legends_batch(items: list[dict], api_key: str, model: str) -> dict[int, dict]:
    """
    items: [{"id": int, "text": str}, ...] — text non vide.
    Retourne {id: {"label": "public"|"private", "reason": str}}. Les id
    absents du résultat (erreur réseau/parsing sur leur lot, item omis par
    le modèle) sont simplement absents du dict — c'est à l'appelant de
    décider du repli (game_router.py ne touche pas visibility pour eux).
    """
    if not api_key or not items:
        return {}

    chunks = [items[i:i + CHUNK_SIZE] for i in range(0, len(items), CHUNK_SIZE)]
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHUNKS)

    async def _bounded(chunk: list[dict]) -> dict[int, dict]:
        async with semaphore:
            return await _classify_chunk(chunk, api_key, model)

    chunk_results = await asyncio.gather(*(_bounded(c) for c in chunks))
    results: dict[int, dict] = {}
    for r in chunk_results:
        results.update(r)
    return results


async def _classify_chunk(chunk: list[dict], api_key: str, model: str) -> dict[int, dict]:
    prompt = _build_prompt(chunk)
    valid_ids = {item["id"] for item in chunk}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            resp = await client.post(
                GEMINI_URL.format(model=model),
                params={"key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        log.warning(f"Classification Gemini échouée pour un lot de {len(chunk)} légende(s) : {e}")
        return {}

    raw = (
        data.get("candidates", [{}])[0]
        .get("content", {})
        .get("parts", [{}])[0]
        .get("text", "")
    )
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        log.warning(f"Réponse Gemini non-JSON pour un lot de légendes : {raw[:200]!r}")
        return {}

    out: dict[int, dict] = {}
    for entry in parsed if isinstance(parsed, list) else []:
        try:
            item_id = int(entry["id"])
        except (KeyError, TypeError, ValueError):
            continue
        if item_id not in valid_ids:
            continue  # id halluciné par le modèle, hors du lot envoyé
        label = entry.get("label")
        if label not in ("public", "private"):
            continue
        out[item_id] = {"label": label, "reason": str(entry.get("reason", ""))[:200]}
    return out
