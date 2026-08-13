#!/usr/bin/env python3
"""
Harnais de test pour calibrer le prompt de legend_moderation.py.

Usage :
    cd server
    GEMINI_API_KEY=... python scripts/tune_legend_moderation.py
    # ou : python scripts/tune_legend_moderation.py --api-key ... --model gemini-2.5-flash

Charge un jeu d'exemples étiquetés (texte + label attendu), les fait
classifier par classify_legends_batch(), puis affiche :
  - accuracy globale
  - matrice de confusion (public/private)
  - le détail de chaque erreur, avec la raison donnée par l'IA, pour itérer
    sur PROMPT_INSTRUCTIONS dans legend_moderation.py.

Ne touche à aucune DB — test isolé du prompt, pas une classification réelle.
Éditer legend_moderation_testset.json pour ajouter de vraies légendes Memoss
(et votre propre jugement public/privé) à mesure que le prompt est ajusté.
Après chaque modif de PROMPT_INSTRUCTIONS, relancer ce script pour voir si
l'accuracy et les erreurs s'améliorent — c'est le cycle d'itération attendu,
pas un test à faire passer une seule fois.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # importe legend_moderation depuis server/
from legend_moderation import classify_legends_batch  # noqa: E402


def load_testset(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    for i, item in enumerate(data):
        if "text" not in item or "expected" not in item:
            raise ValueError(f"Entrée {i} du testset invalide (attend 'text' et 'expected'): {item}")
        if item["expected"] not in ("public", "private"):
            raise ValueError(f"Entrée {i}: expected doit être 'public' ou 'private', reçu {item['expected']!r}")
    return data


async def main() -> int:
    parser = argparse.ArgumentParser(description="Teste et calibre le prompt de classification des légendes.")
    parser.add_argument("--testset", type=Path, default=Path(__file__).parent / "legend_moderation_testset.json")
    parser.add_argument("--model", default="gemini-2.5-flash")
    parser.add_argument("--api-key", default=None, help="Sinon lu depuis $GEMINI_API_KEY")
    args = parser.parse_args()

    api_key = args.api_key or os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("Erreur : fournis une clé Gemini via --api-key ou $GEMINI_API_KEY", file=sys.stderr)
        return 1

    examples = load_testset(args.testset)
    items = [{"id": i, "text": ex["text"]} for i, ex in enumerate(examples)]

    print(f"Classification de {len(items)} légende(s) via {args.model}...\n")
    results = await classify_legends_batch(items, api_key, args.model)

    missing = [i for i in range(len(examples)) if i not in results]
    if missing:
        print(f"⚠️  {len(missing)} légende(s) sans réponse (erreur réseau/parsing) — voir les logs ci-dessus.\n")

    correct = 0
    confusion = {"public": {"public": 0, "private": 0}, "private": {"public": 0, "private": 0}}
    mismatches = []

    for i, ex in enumerate(examples):
        result = results.get(i)
        if result is None:
            continue
        expected, got = ex["expected"], result["label"]
        confusion[expected][got] += 1
        if got == expected:
            correct += 1
        else:
            mismatches.append((ex["text"], expected, got, result["reason"], ex.get("note", "")))

    total = len(examples) - len(missing)
    accuracy = correct / total * 100 if total else 0

    print(f"── Résultat : {correct}/{total} corrects ({accuracy:.0f}%) ──\n")
    print("Matrice de confusion (ligne = attendu, colonne = obtenu par l'IA) :")
    print("                 obtenu:public  obtenu:private")
    print(f"attendu:public  {confusion['public']['public']:>13}  {confusion['public']['private']:>14}")
    print(f"attendu:private {confusion['private']['public']:>13}  {confusion['private']['private']:>14}")

    if mismatches:
        print(f"\n── {len(mismatches)} erreur(s) à examiner pour ajuster PROMPT_INSTRUCTIONS ──\n")
        for text, expected, got, reason, note in mismatches:
            print(f'  "{text}"')
            print(f"    attendu={expected}  obtenu={got}  raison IA=\"{reason}\"")
            if note:
                print(f"    (note testset: {note})")
            print()
    else:
        print("\nAucune erreur sur ce testset.")

    return 0 if not mismatches else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
