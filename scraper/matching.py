from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher


BRAND_ALIASES = {
    "black and decker": "black decker", "black decker": "black decker",
    "da co": "damasco", "daco": "damasco", "damasco home": "damasco",
    "damascohome": "damasco", "damasco technology": "damasco",
    "xiaomi redmi": "xiaomi",
}
KNOWN_BRANDS = (
    "black and decker", "hewlett packard", "damasco technology", "xiaomi redmi",
    "hamilton beach", "samsung", "whirlpool", "frigidaire", "indurama",
    "brentwood", "remington", "motorola", "infinix", "philips", "hisense",
    "damasco", "galanz", "oster", "midea", "royal", "ninja", "sharp",
    "sony", "apple", "xiaomi", "honor", "tecno", "realme", "vidvie",
    "milexus", "ecasa", "huawei", "lenovo", "daewoo", "lg", "jbl",
    "rca", "acer", "asus", "epson",
)
GENERIC_MODEL = re.compile(
    r"^(?:\d+(?:\.\d+)?(?:V|W|HZ|BTU|KG|L|LTS|PULG|GB|TB|CM|MM|OZ|PIES)|\d+K|\d+X\d+)$",
    re.IGNORECASE,
)
MODEL_TOKEN = re.compile(
    r"(?=[A-Z0-9/-]{4,})(?=[A-Z0-9/-]*[A-Z])(?=[A-Z0-9/-]*\d)"
    r"[A-Z0-9]+(?:[-/][A-Z0-9]+)*"
)
PRODUCT_TYPES = {
    "nevera": r"\b(nevera|refrigerador|refrigeradora)\b",
    "lavadora": r"\b(lavadora|lavarropas)\b", "secadora": r"\bsecadora\b",
    "microondas": r"\bmicroonda[s]?\b",
    "aire_acondicionado": r"\b(aire acondicionado|a a|ac split|aire split)\b",
    "televisor": r"\b(televisor|smart tv|tv)\b", "licuadora": r"\blicuadora\b",
    "freidora": r"\bfreidora\b", "cafetera": r"\bcafetera\b",
    "batidora": r"\bbatidora\b", "cocina": r"\bcocina\b",
    "congelador": r"\bcongelador\b", "horno": r"\bhorno\b",
    "plancha_cabello": r"\bplancha\b.*\bcabello\b",
    "afeitadora": r"\b(afeitadora|maquina para afeitar|maquina de afeitar)\b",
    "corneta": r"\b(corneta|parlante|speaker)\b", "monitor": r"\bmonitor\b",
    "aspiradora": r"\baspiradora\b", "lavavajillas": r"\b(lavavajillas|lavaplatos)\b",
    "vinera": r"\bvinera\b", "tope": r"\btope\b", "campana": r"\bcampana\b",
}
TECHNOLOGIES = {
    "inverter", "qled", "oled", "uhd", "4k", "8k", "smart", "wifi",
    "french door", "side by side", "carga frontal", "carga superior",
    "doble tina", "semiautomatica", "automatica",
}


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = value.lower().replace("+", " ").replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _brand_in_name(name: str) -> str | None:
    normalized = normalize(name)
    if re.search(r"\b(?:da\s*co|daco)\b", normalized):
        return "damasco"
    for brand in KNOWN_BRANDS:
        if re.search(rf"\b{re.escape(brand)}\b", normalized):
            return BRAND_ALIASES.get(brand, brand)
    return None


def infer_brand(name: str, explicit: str | None = None) -> str | None:
    name_brand = _brand_in_name(name)
    if name_brand:
        return name_brand
    candidate = normalize(explicit or "")
    return BRAND_ALIASES.get(candidate, candidate) or None


def model_tokens(name: str, explicit: str | None = None) -> set[str]:
    source = f"{explicit or ''} {name}".upper().replace("DA+CO", "DAMASCO")
    tokens = set()
    for token in MODEL_TOKEN.findall(source):
        cleaned = token.strip("-/")
        if len(cleaned) >= 4 and not GENERIC_MODEL.match(cleaned):
            tokens.add(cleaned)
    return tokens


def product_type(name: str) -> str | None:
    normalized = normalize(name)
    for kind, pattern in PRODUCT_TYPES.items():
        if re.search(pattern, normalized):
            return kind
    return None


def attribute_signature(name: str) -> set[str]:
    normalized = unicodedata.normalize("NFKD", name or "")
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = normalized.lower().replace(",", ".")
    normalized = re.sub(r"[^a-z0-9.]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    normalized = normalized.replace("pulgadas", "pulg").replace("pulgada", "pulg")
    normalized = normalized.replace("litros", "l").replace("litro", "l")
    attributes = {
        f"{number}:{unit}"
        for number, unit in re.findall(
            r"\b(\d+(?:\.\d+)?)\s*(btu|kg|pulg|l|w|oz|pies|gb|tb|hz)\b", normalized
        )
    }
    for technology in TECHNOLOGIES:
        if technology in normalized:
            attributes.add(f"tech:{technology}")
    return attributes


def similarity(left: dict, right: dict) -> tuple[float, str, dict]:
    left_name, right_name = normalize(left["name"]), normalize(right["name"])
    left_brand = infer_brand(left["name"], left.get("brand"))
    right_brand = infer_brand(right["name"], right.get("brand"))
    left_type, right_type = product_type(left["name"]), product_type(right["name"])
    if left_brand and right_brand and left_brand != right_brand:
        return 0.0, "brand_conflict", {}
    if left_type and right_type and left_type != right_type:
        return 0.0, "type_conflict", {}

    shared_models = sorted(model_tokens(left["name"], left.get("model")) & model_tokens(right["name"], right.get("model")))
    shared_attributes = sorted(attribute_signature(left["name"]) & attribute_signature(right["name"]))
    left_words, right_words = set(left_name.split()), set(right_name.split())
    union = left_words | right_words
    token_score = len(left_words & right_words) / len(union) if union else 0.0
    sequence_score = SequenceMatcher(None, left_name, right_name).ratio()
    brand_equal = bool(left_brand and right_brand and left_brand == right_brand)
    type_equal = bool(left_type and right_type and left_type == right_type)

    if shared_models and (not left_brand or not right_brand or brand_equal):
        score = min(0.99, 0.91 + (0.04 if brand_equal else 0) + (0.04 * max(token_score, sequence_score)))
        method = "model_brand" if brand_equal else "model"
    elif brand_equal and type_equal:
        numeric_shared = [value for value in shared_attributes if not value.startswith("tech:")]
        technology_shared = [value for value in shared_attributes if value.startswith("tech:")]
        score = 0.60 + min(0.18, 0.12 * len(numeric_shared))
        score += min(0.06, 0.03 * len(technology_shared))
        score += 0.10 * token_score + 0.08 * sequence_score
        if not shared_attributes and max(token_score, sequence_score) < 0.70:
            return 0.0, "insufficient", {}
        score, method = min(0.89, score), "brand_type_attributes"
    else:
        return 0.0, "insufficient", {}

    return round(score, 4), method, {
        "brand": left_brand or right_brand, "productType": left_type or right_type,
        "sharedModels": shared_models, "sharedAttributes": shared_attributes,
        "tokenSimilarity": round(token_score, 4), "nameSimilarity": round(sequence_score, 4),
    }


def refresh_damasco_matches(database_url: str) -> dict[str, int]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        daka = [dict(row) for row in conn.execute("""
            SELECT p.id, p.name, p.brand, p.model FROM products p
            JOIN sources s ON s.id = p.source_id WHERE s.slug = 'daka'
        """).fetchall()]
        damasco = [dict(row) for row in conn.execute("""
            SELECT p.id, p.name, p.brand, p.model FROM products p
            JOIN sources s ON s.id = p.source_id WHERE s.slug = 'damasco'
        """).fetchall()]
        protected = conn.execute("""
            SELECT pm.daka_product_id, pm.competitor_product_id, pm.status
            FROM product_matches pm JOIN products c ON c.id = pm.competitor_product_id
            JOIN sources s ON s.id = c.source_id
            WHERE s.slug = 'damasco' AND pm.status IN ('confirmed', 'rejected')
        """).fetchall()
        confirmed_daka = {row["daka_product_id"] for row in protected if row["status"] == "confirmed"}
        confirmed_competitors = {row["competitor_product_id"] for row in protected if row["status"] == "confirmed"}
        rejected_pairs = {(row["daka_product_id"], row["competitor_product_id"]) for row in protected if row["status"] == "rejected"}

        by_model: dict[str, list[dict]] = {}
        by_brand_type: dict[tuple[str, str], list[dict]] = {}
        for product in damasco:
            for token in model_tokens(product["name"], product.get("model")):
                by_model.setdefault(token, []).append(product)
            brand, kind = infer_brand(product["name"], product.get("brand")), product_type(product["name"])
            if brand and kind:
                by_brand_type.setdefault((brand, kind), []).append(product)

        automatic, review = [], []
        for source in daka:
            if source["id"] in confirmed_daka:
                continue
            candidates: dict[int, dict] = {}
            for token in model_tokens(source["name"], source.get("model")):
                for candidate in by_model.get(token, []):
                    candidates[candidate["id"]] = candidate
            brand, kind = infer_brand(source["name"], source.get("brand")), product_type(source["name"])
            if brand and kind:
                for candidate in by_brand_type.get((brand, kind), []):
                    candidates[candidate["id"]] = candidate

            scored = []
            for candidate in candidates.values():
                if candidate["id"] in confirmed_competitors or (source["id"], candidate["id"]) in rejected_pairs:
                    continue
                score, method, evidence = similarity(source, candidate)
                if score >= 0.72:
                    scored.append((score, source, candidate, method, evidence))
            scored.sort(key=lambda row: row[0], reverse=True)
            exact = [row for row in scored if row[0] >= 0.90]
            if exact:
                automatic.append(exact[0])
            else:
                review.extend(scored[:3])

        automatic.sort(key=lambda row: row[0], reverse=True)
        used_daka, used_competitors, accepted_automatic = set(confirmed_daka), set(confirmed_competitors), []
        for proposal in automatic:
            _, source, candidate, _, _ = proposal
            if source["id"] not in used_daka and candidate["id"] not in used_competitors:
                used_daka.add(source["id"]); used_competitors.add(candidate["id"])
                accepted_automatic.append(proposal)

        conn.execute("""
            DELETE FROM product_matches pm USING products c, sources s
            WHERE pm.competitor_product_id = c.id AND c.source_id = s.id
              AND s.slug = 'damasco' AND pm.status IN ('auto', 'review')
        """)
        saved = []
        for status, proposals in (("auto", accepted_automatic), ("review", review)):
            for score, source, candidate, method, evidence in proposals:
                conn.execute("""
                    INSERT INTO product_matches
                      (daka_product_id, competitor_product_id, status, match_method, confidence, evidence)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (daka_product_id, competitor_product_id) DO UPDATE SET
                      status = CASE WHEN product_matches.status IN ('confirmed', 'rejected')
                        THEN product_matches.status ELSE EXCLUDED.status END,
                      match_method = EXCLUDED.match_method, confidence = EXCLUDED.confidence,
                      evidence = EXCLUDED.evidence, updated_at = NOW()
                """, (source["id"], candidate["id"], status, method, score, json.dumps(evidence)))
                saved.append(status)

        return {"automatic": saved.count("auto"), "review": saved.count("review"),
                "confirmed": len(confirmed_daka), "dakaProducts": len(daka),
                "damascoProducts": len(damasco)}
