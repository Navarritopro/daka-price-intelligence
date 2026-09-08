from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher


MATCH_ENGINE_VERSION = "2.2"
AUTO_THRESHOLD = 0.93
REVIEW_THRESHOLD = 0.66
MAX_REVIEW_CANDIDATES = 5

BRAND_ALIASES = {
    "black and decker": "black decker", "black decker": "black decker",
    "black+decker": "black decker", "b d": "black decker",
    "da co": "damasco", "daco": "damasco", "damasco home": "damasco",
    "damascohome": "damasco", "damasco technology": "damasco",
    "general electric": "ge", "ge appliances": "ge",
    "hewlett packard": "hp", "hp inc": "hp", "xiaomi redmi": "xiaomi",
    "mabe internacional": "mabe", "american star": "americanstar",
    "tp link": "tplink", "tp-link": "tplink", "tplink": "tplink",
    "d link": "dlink", "d-link": "dlink", "dlink": "dlink",
}
KNOWN_BRANDS = tuple(sorted({
    "black and decker", "black decker", "hewlett packard", "damasco technology",
    "xiaomi redmi", "hamilton beach", "general electric", "ge appliances",
    "american star", "samsung", "whirlpool", "frigidaire", "indurama", "brentwood",
    "remington", "motorola", "infinix", "philips", "hisense", "damasco", "galanz",
    "oster", "midea", "royal", "ninja", "sharp", "sony", "apple", "xiaomi", "honor",
    "tecno", "realme", "vidvie", "milexus", "ecasa", "huawei", "lenovo", "daewoo",
    "mabe", "electrolux", "bosch", "panasonic", "tcl", "siragon", "cyberlux",
    "premier", "mastertech", "condesa", "atlas", "westinghouse", "klip xtreme",
    "logitech", "canon", "nikon", "kitchenaid", "cuisinart", "holstein", "taurus",
    "imusa", "umco", "arno", "gama", "babyliss", "rowenta", "dyson", "ge",
    "tp link", "tp-link", "tplink", "d link", "d-link", "dlink", "mercusys",
    "tenda", "linksys", "ubiquiti", "mikrotik", "netis", "zte",
    "hp", "lg", "jbl", "rca", "acer", "asus", "epson",
}, key=len, reverse=True))

GENERIC_MODEL = re.compile(
    r"^(?:\d+(?:[.]\d+)?(?:V|W|HZ|GHZ|MHZ|MBPS|GBPS|BTU|KG|LB|L|LTS|PULG|IN|GB|TB|CM|MM|OZ|PIES)|"
    r"\d+K|\d+X\d+|(?:FULL)?HD|UHD|QLED|OLED|SMART|WIFI|INVERTER)$",
    re.IGNORECASE,
)
GENERIC_CONNECTIVITY_MODELS = {
    "ADSL", "ADSL2", "VDSL", "VDSL2", "DOCSIS", "ETHERNET",
    "WIFI", "WIFI4", "WIFI5", "WIFI6", "WIFI6E", "WIFI7",
    "USB2", "USB3", "HDMI1", "HDMI2", "BT4", "BT5",
    "BLUETOOTH4", "BLUETOOTH5", "LAN", "WAN",
}
MODEL_TOKEN = re.compile(
    r"(?=[A-Z0-9./-]{4,})(?=[A-Z0-9./-]*[A-Z])(?=[A-Z0-9./-]*\d)"
    r"[A-Z0-9]+(?:[./-][A-Z0-9]+)*"
)
MODEL_FAMILY_TOKEN = re.compile(r"\b[A-Z]{1,3}\d{2,4}[A-Z0-9]*\b")
PRODUCT_TYPES = {
    "nevera": r"\b(nevera|refrigerador|refrigeradora|frigorifico)\b",
    "lavadora": r"\b(lavadora|lavarropas|centro de lavado)\b", "secadora": r"\bsecadora\b",
    "microondas": r"\bmicroonda[s]?\b", "aire_acondicionado": r"\b(aire acondicionado|a a|ac split|aire split|split)\b",
    "televisor": r"\b(televisor|smart tv|google tv|android tv|tv)\b", "licuadora": r"\blicuadora\b",
    "freidora": r"\b(freidora|air fryer)\b", "cafetera": r"\bcafetera\b", "batidora": r"\bbatidora\b",
    "cocina": r"\b(cocina|estufa)\b", "congelador": r"\b(congelador|freezer)\b", "horno": r"\bhorno\b",
    "plancha_cabello": r"\bplancha\b.*\bcabello\b", "plancha_ropa": r"\bplancha(?: de ropa| a vapor)?\b",
    "afeitadora": r"\b(afeitadora|maquina para afeitar|maquina de afeitar)\b",
    "corneta": r"\b(corneta|parlante|speaker|barra de sonido|soundbar)\b", "monitor": r"\bmonitor\b",
    "aspiradora": r"\baspiradora\b", "lavavajillas": r"\b(lavavajillas|lavaplatos)\b",
    "vinera": r"\bvinera\b", "tope": r"\b(tope|encimera)\b", "campana": r"\bcampana\b",
    "telefono": r"\b(telefono|smartphone|celular)\b", "tablet": r"\btablet\b",
    "laptop": r"\b(laptop|notebook|computadora portatil)\b", "impresora": r"\b(impresora|multifuncional)\b",
    "ventilador": r"\bventilador\b", "calentador": r"\bcalentador\b",
    "dispensador": r"\bdispensador\b", "extractor": r"\bextractor\b",
    "modem": r"\b(modem|adsl|vdsl)\b", "router": r"\b(router|enrutador)\b",
    "repetidor": r"\b(repetidor|extensor de rango|range extender)\b",
    "sistema_mesh": r"\b(mesh|wifi mallado)\b",
    "access_point": r"\b(access point|punto de acceso)\b",
}
TECHNOLOGY_ALIASES = {
    "inverter": ("inverter",), "qled": ("qled",), "oled": ("oled",), "uhd": ("uhd", "ultra hd"),
    "4k": ("4k",), "8k": ("8k",), "smart": ("smart",), "wifi": ("wifi", "wi fi"),
    "french door": ("french door",), "side by side": ("side by side",),
    "carga frontal": ("carga frontal",), "carga superior": ("carga superior",),
    "doble tina": ("doble tina",), "semiautomatica": ("semiautomatica",),
    "automatica": ("automatica",), "no frost": ("no frost",),
    "adsl": ("adsl",), "adsl2": ("adsl2",), "vdsl": ("vdsl",), "vdsl2": ("vdsl2",),
    "wifi 6": ("wifi 6", "wifi6"), "wifi 6e": ("wifi 6e", "wifi6e"),
    "wifi 7": ("wifi 7", "wifi7"), "doble banda": ("doble banda", "dual band"),
    "gigabit": ("gigabit",),
}
COLOR_WORDS = {
    "amarillo", "azul", "beige", "blanco", "blanca", "dorado", "dorada", "gris",
    "morado", "morada", "naranja", "negro", "negra", "plateado", "plateada",
    "rojo", "roja", "rosado", "rosada", "verde", "violeta",
}
STOP_WORDS = {
    "de", "del", "la", "el", "los", "las", "con", "para", "por", "y", "en",
    "color", "nuevo", "nueva", "oferta", "unidad", "unidades", "marca", "modelo",
    *COLOR_WORDS,
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
        if re.search(rf"\b{re.escape(normalize(brand))}\b", normalized):
            return BRAND_ALIASES.get(brand, BRAND_ALIASES.get(normalize(brand), normalize(brand)))
    return None


def infer_brand(name: str, explicit: str | None = None) -> str | None:
    name_brand = _brand_in_name(name)
    if name_brand:
        return name_brand
    candidate = normalize(explicit or "")
    return BRAND_ALIASES.get(candidate, candidate) or None


def canonical_model(token: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (token or "").upper())


def _is_generic_model(token: str) -> bool:
    canonical = canonical_model(token)
    return bool(
        GENERIC_MODEL.match(token)
        or GENERIC_MODEL.match(canonical)
        or canonical in GENERIC_CONNECTIVITY_MODELS
        or re.fullmatch(r"\d+(?:MBPS|GBPS|GHZ|MHZ|PORTS?|PUERTOS?|ANTENNAS?|ANTENAS?)", canonical)
    )


def model_tokens(name: str, explicit: str | None = None) -> set[str]:
    source = f"{explicit or ''} {name}".upper().replace("DA+CO", "DAMASCO")
    tokens = set()
    for token in MODEL_TOKEN.findall(source):
        cleaned = token.strip("-/. ")
        canonical = canonical_model(cleaned)
        if len(canonical) >= 4 and not _is_generic_model(cleaned):
            tokens.add(canonical)
    # Familias comerciales cortas frecuentes en telefonía (A06, S26, G54) no
    # cumplen el mínimo general de cuatro caracteres, pero son discriminantes
    # cuando marca y tipo también coinciden.
    for token in MODEL_FAMILY_TOKEN.findall(source):
        canonical = canonical_model(token)
        if not _is_generic_model(canonical):
            tokens.add(canonical)
    return tokens


def color_tokens(name: str) -> set[str]:
    return set(normalize(name).split()) & COLOR_WORDS


def product_type(name: str, category: str | None = None) -> str | None:
    normalized = normalize(f"{name} {category or ''}")
    for kind, pattern in PRODUCT_TYPES.items():
        if re.search(pattern, normalized):
            return kind
    return None


def _attribute_values(name: str) -> dict[str, set[float | str]]:
    raw = unicodedata.normalize("NFKD", name or "")
    raw = "".join(char for char in raw if not unicodedata.combining(char))
    raw = raw.lower().replace(",", ".").replace("³", "3")
    raw = raw.replace("”", " pulg ").replace("“", " pulg ").replace('"', " pulg ")
    raw = re.sub(r"[^a-z0-9.]+", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    unit_aliases = {"pulgadas": "pulg", "pulgada": "pulg", "pulg": "pulg", "in": "pulg", "litros": "l", "litro": "l", "lts": "l", "lt": "l", "l": "l", "watts": "w", "watt": "w", "w": "w", "libras": "lb", "libra": "lb", "pies cubicos": "ft3", "pie cubico": "ft3", "cu ft": "ft3", "ft3": "ft3", "megabits": "mbps", "mbps": "mbps", "gbps": "mbps", "antena": "antenas", "antenas": "antenas", "puerto": "puertos", "puertos": "puertos"}
    values: dict[str, set[float | str]] = defaultdict(set)
    pattern = r"\b(\d+(?:\.\d+)?)\s*(btu|kg|pulgadas|pulgada|pulg|in|litros|litro|lts|lt|l|watts|watt|w|oz|lb|libras|libra|pies cubicos|pie cubico|cu ft|ft3|gb|tb|hz|ghz|mhz|megabits|mbps|gbps|antena|antenas|puerto|puertos)\b"
    for number, raw_unit in re.findall(pattern, raw):
        # Spanish catalog names often use a dot as a thousands separator (12.000 BTU).
        parsed_number = float(number.replace(".", "")) if re.fullmatch(r"\d+\.\d{3}", number) else float(number)
        unit = unit_aliases.get(raw_unit, raw_unit)
        values[unit].add(parsed_number * 1000 if raw_unit == "gbps" else parsed_number)
    number_words = {"una": 1.0, "un": 1.0, "uno": 1.0, "dos": 2.0, "tres": 3.0, "cuatro": 4.0, "cinco": 5.0, "seis": 6.0, "ocho": 8.0}
    for word, unit in re.findall(r"\b(una|un|uno|dos|tres|cuatro|cinco|seis|ocho)\s+(antena|antenas|puerto|puertos)\b", raw):
        values[unit_aliases[unit]].add(number_words[word])
    if re.search(r"\b(?:wifi|wi fi|inalambrico|wireless).*?\b(?:802 11)?n\b", raw):
        values["technology"].add("wireless n")
    if re.search(r"\b(?:wifi|wi fi|inalambrico|wireless).*?\b(?:802 11)?ac\b", raw):
        values["technology"].add("wireless ac")
    if re.search(r"\b(?:wifi|wi fi|inalambrico|wireless).*?\b(?:802 11)?ax\b", raw):
        values["technology"].add("wireless ax")
    for technology, aliases in TECHNOLOGY_ALIASES.items():
        if any(re.search(rf"\b{re.escape(alias)}\b", raw) for alias in aliases):
            values["technology"].add(technology)
    return values


def attribute_signature(name: str) -> set[str]:
    attributes = set()
    for unit, values in _attribute_values(name).items():
        for value in values:
            if unit == "technology":
                attributes.add(f"tech:{value}")
            else:
                rendered = str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)
                attributes.add(f"{rendered}:{unit}")
    return attributes


def _numeric_conflicts(left: dict[str, set[float | str]], right: dict[str, set[float | str]]) -> list[str]:
    conflicts = []
    for unit in sorted((set(left) & set(right)) - {"technology"}):
        left_numbers = {float(value) for value in left[unit]}
        right_numbers = {float(value) for value in right[unit]}
        if not any(abs(a - b) <= max(0.1, max(a, b) * 0.02) for a in left_numbers for b in right_numbers):
            conflicts.append(f"{unit}: {sorted(left_numbers)} vs {sorted(right_numbers)}")
    return conflicts


def _meaningful_words(value: str) -> set[str]:
    return {word for word in normalize(value).split() if len(word) > 2 and word not in STOP_WORDS}


def similarity(left: dict, right: dict) -> tuple[float, str, dict]:
    left_name, right_name = normalize(left["name"]), normalize(right["name"])
    left_brand = infer_brand(left["name"], left.get("brand")); right_brand = infer_brand(right["name"], right.get("brand"))
    left_type = product_type(left["name"], left.get("category")); right_type = product_type(right["name"], right.get("category"))
    evidence = {"engineVersion": MATCH_ENGINE_VERSION, "warnings": [], "conflicts": [], "variantNotes": []}
    if left_brand and right_brand and left_brand != right_brand:
        evidence["conflicts"] = [f"Marca: {left_brand} vs {right_brand}"]
        return 0.0, "brand_conflict", evidence
    if left_type and right_type and left_type != right_type:
        evidence["conflicts"] = [f"Tipo: {left_type} vs {right_type}"]
        return 0.0, "type_conflict", evidence

    shared_models = sorted(model_tokens(left["name"], left.get("model")) & model_tokens(right["name"], right.get("model")))
    left_attributes, right_attributes = _attribute_values(left["name"]), _attribute_values(right["name"])
    shared_attributes = sorted(attribute_signature(left["name"]) & attribute_signature(right["name"]))
    numeric_conflicts = _numeric_conflicts(left_attributes, right_attributes)
    left_words, right_words = _meaningful_words(left_name), _meaningful_words(right_name)
    union = left_words | right_words
    token_score = len(left_words & right_words) / len(union) if union else 0.0
    sequence_score = SequenceMatcher(None, left_name, right_name).ratio()
    name_score = max(token_score, sequence_score)
    brand_equal = bool(left_brand and right_brand and left_brand == right_brand)
    type_equal = bool(left_type and right_type and left_type == right_type)
    left_colors, right_colors = color_tokens(left["name"]), color_tokens(right["name"])
    if left_colors and right_colors and left_colors.isdisjoint(right_colors):
        evidence["variantNotes"].append(
            f"Variante de color: {', '.join(sorted(left_colors))} vs {', '.join(sorted(right_colors))}"
        )

    if shared_models:
        score = 0.94 + (0.025 if brand_equal else 0) + (0.015 if type_equal else 0)
        if numeric_conflicts:
            evidence["warnings"].append("El modelo coincide, pero hay especificaciones numéricas distintas")
            score -= 0.03
        method = "model_brand" if brand_equal else "model"
    else:
        if numeric_conflicts:
            evidence["conflicts"] = numeric_conflicts
            return 0.0, "attribute_conflict", evidence
        numeric_shared = [value for value in shared_attributes if not value.startswith("tech:")]
        technology_shared = [value for value in shared_attributes if value.startswith("tech:")]
        if brand_equal and type_equal:
            score = 0.55 + min(0.20, 0.10 * len(numeric_shared)) + min(0.08, 0.025 * len(technology_shared)) + 0.12 * token_score + 0.10 * sequence_score
            method = "brand_type_attributes"
        elif type_equal and numeric_shared and (name_score >= 0.35 or technology_shared):
            score = 0.48 + min(0.18, 0.10 * len(numeric_shared)) + min(0.08, 0.04 * len(technology_shared)) + 0.18 * name_score
            method = "type_attributes"; evidence["warnings"].append("La marca no está disponible en ambos catálogos")
        elif brand_equal and (numeric_shared or name_score >= 0.62):
            score = 0.50 + min(0.16, 0.10 * len(numeric_shared)) + 0.18 * name_score
            method = "brand_attributes"; evidence["warnings"].append("El tipo de producto no pudo confirmarse en ambos catálogos")
        else:
            return 0.0, "insufficient", evidence
        if left_type in {"modem", "router", "repetidor", "sistema_mesh", "access_point"}:
            critical_units = {"mbps", "ghz", "antenas", "puertos"}
            missing_right = sorted((set(left_attributes) & critical_units) - set(right_attributes))
            if missing_right:
                score -= min(0.12, 0.04 * len(missing_right))
                evidence["warnings"].append(
                    "Faltan especificaciones de conectividad en la alternativa: " + ", ".join(missing_right)
                )
        if score < REVIEW_THRESHOLD:
            return 0.0, "insufficient", evidence
        score = min(0.89, score)

    evidence.update({"brand": left_brand or right_brand, "productType": left_type or right_type, "sharedModels": shared_models, "sharedAttributes": shared_attributes, "tokenSimilarity": round(token_score, 4), "nameSimilarity": round(sequence_score, 4), "conflicts": numeric_conflicts})
    return round(min(0.99, score), 4), method, evidence


def refresh_competitor_matches(database_url: str, competitor_slug: str) -> dict[str, int | str]:
    """Rebuild automatic/review proposals for one competitor.

    Confirmed and rejected decisions are deliberately kept per competitor source.
    """
    import psycopg
    from psycopg.rows import dict_row

    if not competitor_slug or competitor_slug == "daka":
        raise ValueError("La fuente competidora debe ser distinta de DAKA")

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        daka = [dict(row) for row in conn.execute("""SELECT p.id, p.name, p.brand, p.model, p.category FROM products p JOIN sources s ON s.id = p.source_id WHERE s.slug = 'daka'""").fetchall()]
        competitor = [dict(row) for row in conn.execute("""SELECT p.id, p.name, p.brand, p.model, p.category FROM products p JOIN sources s ON s.id = p.source_id WHERE s.slug = %s""", (competitor_slug,)).fetchall()]
        protected = conn.execute("""SELECT pm.daka_product_id, pm.competitor_product_id, pm.status FROM product_matches pm JOIN products c ON c.id = pm.competitor_product_id JOIN sources s ON s.id = c.source_id WHERE s.slug = %s AND pm.status IN ('confirmed', 'rejected')""", (competitor_slug,)).fetchall()
        confirmed_daka = {row["daka_product_id"] for row in protected if row["status"] == "confirmed"}
        confirmed_competitors = {row["competitor_product_id"] for row in protected if row["status"] == "confirmed"}
        rejected_pairs = {(row["daka_product_id"], row["competitor_product_id"]) for row in protected if row["status"] == "rejected"}

        by_model, by_brand_type, by_brand, by_type = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
        for product in competitor:
            for token in model_tokens(product["name"], product.get("model")): by_model[token].append(product)
            brand = infer_brand(product["name"], product.get("brand")); kind = product_type(product["name"], product.get("category"))
            if brand: by_brand[brand].append(product)
            if kind: by_type[kind].append(product)
            if brand and kind: by_brand_type[(brand, kind)].append(product)

        automatic, review, products_with_candidates = [], [], 0
        for source in daka:
            if source["id"] in confirmed_daka: continue
            candidates: dict[int, dict] = {}
            for token in model_tokens(source["name"], source.get("model")):
                for candidate in by_model.get(token, []): candidates[candidate["id"]] = candidate
            brand = infer_brand(source["name"], source.get("brand")); kind = product_type(source["name"], source.get("category"))
            groups = []
            if brand and kind: groups.append(by_brand_type.get((brand, kind), []))
            if brand: groups.append(by_brand.get(brand, []))
            if kind: groups.append(by_type.get(kind, []))
            for group in groups:
                for candidate in group: candidates[candidate["id"]] = candidate
            scored = []
            for candidate in candidates.values():
                if candidate["id"] in confirmed_competitors or (source["id"], candidate["id"]) in rejected_pairs: continue
                score, method, evidence = similarity(source, candidate)
                if score >= REVIEW_THRESHOLD: scored.append((score, source, candidate, method, evidence))
            scored.sort(key=lambda row: (-row[0], row[2]["id"]))
            if scored: products_with_candidates += 1
            best, runner_up = (scored[0] if scored else None), (scored[1] if len(scored) > 1 else None)
            unambiguous = best and (runner_up is None or best[0] - runner_up[0] >= 0.02)
            if best and best[0] >= AUTO_THRESHOLD and unambiguous and best[3] in {"model", "model_brand"}:
                best[4]["candidateRank"] = 1
                best[4]["candidateCount"] = min(len(scored), MAX_REVIEW_CANDIDATES)
                best[4]["candidateTotal"] = len(scored)
                automatic.append(best)
            else:
                for rank, proposal in enumerate(scored[:MAX_REVIEW_CANDIDATES], start=1):
                    proposal[4]["candidateRank"] = rank
                    proposal[4]["candidateCount"] = min(len(scored), MAX_REVIEW_CANDIDATES)
                    proposal[4]["candidateTotal"] = len(scored)
                    review.append(proposal)

        automatic.sort(key=lambda row: row[0], reverse=True)
        used_daka, used_competitors, accepted_automatic = set(confirmed_daka), set(confirmed_competitors), []
        for proposal in automatic:
            _, source, candidate, _, _ = proposal
            if source["id"] not in used_daka and candidate["id"] not in used_competitors:
                used_daka.add(source["id"]); used_competitors.add(candidate["id"]); accepted_automatic.append(proposal)
            else:
                proposal[4]["warnings"].append("Existe otra homologación con mayor prioridad"); review.append(proposal)

        conn.execute("""DELETE FROM product_matches pm USING products c, sources s WHERE pm.competitor_product_id = c.id AND c.source_id = s.id AND s.slug = %s AND pm.status IN ('auto', 'review')""", (competitor_slug,))
        saved = []
        for status, proposals in (("auto", accepted_automatic), ("review", review)):
            for score, source, candidate, method, evidence in proposals:
                conn.execute("""INSERT INTO product_matches (daka_product_id, competitor_product_id, status, match_method, confidence, evidence) VALUES (%s, %s, %s, %s, %s, %s::jsonb) ON CONFLICT (daka_product_id, competitor_product_id) DO UPDATE SET status = CASE WHEN product_matches.status IN ('confirmed', 'rejected') THEN product_matches.status ELSE EXCLUDED.status END, match_method = EXCLUDED.match_method, confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence, updated_at = NOW()""", (source["id"], candidate["id"], status, method, score, json.dumps(evidence)))
                saved.append(status)
        return {"source": competitor_slug, "automatic": saved.count("auto"), "review": saved.count("review"), "confirmed": len(confirmed_daka), "rejectedPairs": len(rejected_pairs), "productsWithCandidates": products_with_candidates, "dakaProducts": len(daka), "competitorProducts": len(competitor)}


def refresh_damasco_matches(database_url: str) -> dict[str, int | str]:
    """Compatibility wrapper for existing Damasco entry points."""
    return refresh_competitor_matches(database_url, "damasco")


def refresh_all_matches(database_url: str) -> dict[str, dict[str, int | str]]:
    import psycopg

    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            "SELECT slug FROM sources WHERE active = TRUE AND slug <> 'daka' ORDER BY slug"
        ).fetchall()
    return {row[0]: refresh_competitor_matches(database_url, row[0]) for row in rows}
