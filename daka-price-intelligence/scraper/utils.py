from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from urllib.parse import unquote

SAP_PATTERN = re.compile(r"(?:LH|LM|LB|LD|LJ|LC|LF|LL|LT)-\d+", re.IGNORECASE)


def parse_price(raw: str | None) -> Decimal | None:
    if not raw:
        return None
    value = re.sub(r"[^\d,.-]", "", raw).replace("-", "")
    if not value:
        return None
    if "," in value and "." in value:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")
    elif "," in value:
        decimals = len(value) - value.rfind(",") - 1
        value = value.replace(",", ".") if decimals in (1, 2) else value.replace(",", "")
    elif value.count(".") > 1:
        parts = value.split(".")
        value = "".join(parts[:-1]) + "." + parts[-1]
    try:
        parsed = Decimal(value).quantize(Decimal("0.01"))
        return parsed if parsed >= 0 else None
    except InvalidOperation:
        return None


def extract_sap(image_url: str | None, product_url: str | None = None) -> str | None:
    for candidate in (image_url, product_url):
        if not candidate:
            continue
        match = SAP_PATTERN.search(unquote(candidate))
        if match:
            return match.group(0).upper()
    return None
