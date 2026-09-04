from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher

BRAND_ALIASES = {
    "black and decker": "black decker",
    "black decker": "black decker",
    "da co": "damasco",
    "daco": "damasco",
    "damasco home": "damasco",
}
KNOWN_BRANDS = (
    "samsung", "lg", "midea", "oster", "whirlpool", "galanz", "frigidaire",
    "indurama", "royal", "ninja", "philips", "remington", "damasco",
    "black decker", "ecasa", "milexus", "yaz", "sharp", "hisense", "sony",
)
GENERIC_MODEL = re.compile(
    r"^(?:\d+(?:\.\d+)?(?:V|W|HZ|BTU|KG|L|LTS|PULG|GB|TB|CM|MM)|\d+K)$",
    re.IGNORECASE,
)
MODEL_TOKEN = re.compile(r"(?=[A-Z0-9/-]{4,})(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)[A-Z0-9]+(?:[-/][A-Z0-9]+)*")


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.lower().replace("+", " ").replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def infer_brand(name: str, explicit: str | None = None) -> str | None:
    candidate = normalize(explicit or "")
    candidate = BRAND_ALIASES.get(candidate, candidate)
    if candidate:
        return candidate
    normalized = normalize(name)
    for brand in KNOWN_BRANDS:
        if re.search(rf"\b{re.escape(brand)}\b", normalized):
            return BRAND_ALIASES.get(brand, brand)
    if re.search(r"\b(?:da\s*co|daco)\b", normalized):
        return "damasco"
    return None


def model_tokens(name: str, explicit: str | None = None) -> set[str]:
    source = f"{explicit or ''} {name}".upper().replace("DA+CO", "DAMASCO")
    tokens = set()
    for token in MODEL_TOKEN.findall(source):
        cleaned = token.strip("-/")
        if len(cleaned) >= 4 and not GENERIC_MODEL.match(cleaned):
            tokens.add(cleaned)
    return tokens


def similarity(left: dict, right: dict) -> tuple[float, str, dict]:
    left_name = normalize(left["name"])
    right_name = normalize(right["name"])
    left_brand = infer_brand(left["name"], left.get("brand"))
    right_brand = infer_brand(right["name"], right.get("brand"))
    if left_brand and right_brand and left_brand != right_brand:
        return 0.0, "brand_conflict", {}

    left_models = model_tokens(left["name"], left.get("model"))
    right_models = model_tokens(right["name"], right.get("model"))
    shared_models = sorted(left_models & right_models)
    left_words = set(left_name.split())
    right_words = set(right_name.split())
    union = left_words | right_words
    token_score = len(left_words & right_words) / len(union) if union else 0.0
    sequence_score = SequenceMatcher(None, left_name, right_name).ratio()
    brand_equal = bool(left_brand and right_brand and left_brand == right_brand)

    if shared_models:
        score = min(0.99, 0.90 + (0.05 if brand_equal else 0) + (0.04 * max(token_score, sequence_score)))
        method = "model_brand" if brand_equal else "model"
    elif brand_equal and token_score >= 0.60 and sequence_score >= 0.62:
        score = min(0.89, 0.62 + (0.16 * token_score) + (0.11 * sequence_score))
        method = "brand_name"
    else:
        return 0.0, "insufficient", {}

    evidence = {
        "brand": left_brand or right_brand,
        "sharedModels": shared_models,
        "tokenSimilarity": round(token_score, 4),
        "nameSimilarity": round(sequence_score, 4),
    }
    return round(score, 4), method, evidence


def refresh_damasco_matches(database_url: str) -> dict[str, int]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        daka = conn.execute(
            """
            SELECT p.id, p.name, p.brand, p.model
            FROM products p JOIN sources s ON s.id = p.source_id
            WHERE s.slug = 'daka'
            """
        ).fetchall()
        damasco = conn.execute(
            """
            SELECT p.id, p.name, p.brand, p.model
            FROM products p JOIN sources s ON s.id = p.source_id
            WHERE s.slug = 'damasco'
            """
        ).fetchall()

        damasco_by_model: dict[str, list[dict]] = {}
        damasco_by_brand: dict[str, list[dict]] = {}
        for product in damasco:
            product = dict(product)
            for token in model_tokens(product["name"], product.get("model")):
                damasco_by_model.setdefault(token, []).append(product)
            brand = infer_brand(product["name"], product.get("brand"))
            if brand:
                damasco_by_brand.setdefault(brand, []).append(product)

        proposals = []
        for source in daka:
            source = dict(source)
            candidates: dict[int, dict] = {}
            for token in model_tokens(source["name"], source.get("model")):
                for candidate in damasco_by_model.get(token, []):
                    candidates[candidate["id"]] = candidate
            brand = infer_brand(source["name"], source.get("brand"))
            if not candidates and brand:
                for candidate in damasco_by_brand.get(brand, []):
                    candidates[candidate["id"]] = candidate
            best = None
            for candidate in candidates.values():
                score, method, evidence = similarity(source, candidate)
                if score >= 0.75 and (best is None or score > best[0]):
                    best = (score, method, evidence, candidate)
            if best:
                proposals.append((best[0], source, best[3], best[1], best[2]))

        proposals.sort(key=lambda row: row[0], reverse=True)
        used_daka: set[int] = set()
        used_damasco: set[int] = set()
        accepted = []
        for score, source, candidate, method, evidence in proposals:
            if source["id"] in used_daka or candidate["id"] in used_damasco:
                continue
            used_daka.add(source["id"])
            used_damasco.add(candidate["id"])
            accepted.append((source["id"], candidate["id"], "auto" if score >= 0.90 else "review", method, score, evidence))

        conn.execute(
            """
            DELETE FROM product_matches pm
            USING products competitor, sources source
            WHERE pm.competitor_product_id = competitor.id
              AND competitor.source_id = source.id
              AND source.slug = 'damasco'
              AND pm.status IN ('auto', 'review')
            """
        )
        for daka_id, competitor_id, status, method, score, evidence in accepted:
            conn.execute(
                """
                INSERT INTO product_matches
                  (daka_product_id, competitor_product_id, status, match_method, confidence, evidence)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (daka_product_id, competitor_product_id) DO UPDATE SET
                  status = CASE
                    WHEN product_matches.status IN ('confirmed', 'rejected') THEN product_matches.status
                    ELSE EXCLUDED.status
                  END,
                  match_method = EXCLUDED.match_method,
                  confidence = EXCLUDED.confidence,
                  evidence = EXCLUDED.evidence,
                  updated_at = NOW()
                """,
                (daka_id, competitor_id, status, method, score, json.dumps(evidence)),
            )

        return {
            "automatic": sum(1 for row in accepted if row[2] == "auto"),
            "review": sum(1 for row in accepted if row[2] == "review"),
            "dakaProducts": len(daka),
            "damascoProducts": len(damasco),
        }
