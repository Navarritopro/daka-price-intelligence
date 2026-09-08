from __future__ import annotations

import math
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import requests

from database import Database
from matching import canonical_model, model_tokens, refresh_competitor_matches


ACTION_URL = "https://multimax.com.ve/_actions/catalog.query/"
BASE_URL = "https://multimax.com.ve"
VENEZUELA_TZ = ZoneInfo("America/Caracas")
DEVALUE_CONSTANTS = {-1: None, -2: None, -3: math.nan, -4: math.inf, -5: -math.inf, -6: -0.0}


@dataclass(frozen=True)
class Product:
    external_id: str
    name: str
    price_usd: Decimal | None
    url: str
    image_url: str | None
    scraped_at: datetime
    category: str | None = None
    in_stock: bool | None = None
    brand: str | None = None
    model: str | None = None
    list_price_usd: Decimal | None = None
    available_quantity: int | None = None
    metadata: dict = field(default_factory=dict)


def decode_devalue(payload):
    """Decode the flattened JSON format returned by Astro actions."""
    if not isinstance(payload, list):
        return payload
    values = payload
    cache: dict[int, object] = {}

    def resolve(reference):
        if not isinstance(reference, int):
            return reference
        if reference < 0:
            return DEVALUE_CONSTANTS.get(reference)
        if reference in cache:
            return cache[reference]
        value = values[reference]
        if isinstance(value, dict):
            decoded: dict = {}
            cache[reference] = decoded
            decoded.update({key: resolve(item) for key, item in value.items()})
            return decoded
        if isinstance(value, list):
            decoded_list: list = []
            cache[reference] = decoded_list
            decoded_list.extend(resolve(item) for item in value)
            return decoded_list
        cache[reference] = value
        return value

    return resolve(0)


class MultimaxScraper:
    def __init__(self, progress_callback=None):
        self.batch_size = 50
        self.delay = float(os.getenv("MULTIMAX_DELAY_SECONDS", "0.20"))
        self.timeout = int(os.getenv("MULTIMAX_TIMEOUT_SECONDS", "60"))
        self.max_pages = int(os.getenv("MULTIMAX_MAX_PAGES", "100"))
        self.logs: list[dict] = []
        self.pages_scanned = 0
        self.progress_callback = progress_callback
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": BASE_URL,
            "Referer": f"{BASE_URL}/",
            "User-Agent": "DAKA-Price-Lab/3.0 catalog-monitor",
        })

    def log(self, message: str, level: str = "info") -> None:
        stamp = datetime.now(timezone.utc).astimezone(VENEZUELA_TZ).strftime("[%H:%M:%S]")
        self.logs.append({"time": stamp, "level": level, "message": message})
        print(f"{stamp} {message}", flush=True)

    @staticmethod
    def _decimal(value) -> Decimal | None:
        if value is None:
            return None
        try:
            result = Decimal(str(value)).quantize(Decimal("0.01"))
            return result if result >= 0 else None
        except Exception:
            return None

    @staticmethod
    def _category(raw: dict) -> str | None:
        categories = raw.get("categories") or []
        names = [item.get("name") for item in categories if isinstance(item, dict) and item.get("name")]
        return names[-1] if names else None

    @staticmethod
    def _brand(raw: dict) -> str | None:
        brand = raw.get("brand")
        return brand.get("name") if isinstance(brand, dict) else brand if isinstance(brand, str) else None

    @staticmethod
    def _model(raw: dict, name: str, sku: str) -> str | None:
        explicit = raw.get("model")
        if isinstance(explicit, dict):
            explicit = explicit.get("name") or explicit.get("value")
        if explicit:
            return str(explicit)
        canonical_sku = canonical_model(sku)
        if canonical_sku and len(canonical_sku) >= 4 and any(char.isalpha() for char in canonical_sku) and any(char.isdigit() for char in canonical_sku):
            return canonical_sku
        tokens = sorted(model_tokens(name), key=len, reverse=True)
        return tokens[0] if tokens else None

    def fetch_page(self, page: int) -> dict:
        error: Exception | None = None
        for attempt in range(1, 4):
            try:
                response = self.session.post(
                    ACTION_URL,
                    json={"categoryPath": [], "filters": {}, "page": page, "limit": self.batch_size},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                decoded = decode_devalue(response.json())
                if not isinstance(decoded, dict):
                    raise RuntimeError("Multimax devolvió un catálogo con formato inesperado")
                return decoded
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                error = exc
                if attempt < 3:
                    self.log(f"Página {page}: reintento {attempt}/2 por {type(exc).__name__}", "warning")
                    time.sleep(attempt * 2)
        raise RuntimeError(f"No fue posible consultar la página {page}: {error}")

    def parse_product(self, raw: dict, captured_at: datetime) -> Product | None:
        sku = str(raw.get("sku") or raw.get("id") or "").strip()
        name = str(raw.get("name") or sku).strip()
        slug = str(raw.get("slug") or "").strip()
        if not sku or not name:
            return None
        price = self._decimal(raw.get("salePrice") if raw.get("onSale") and raw.get("salePrice") is not None else raw.get("price"))
        base_price = self._decimal(raw.get("price"))
        regular_price = self._decimal(raw.get("regularPrice"))
        list_price = base_price if raw.get("onSale") and base_price and price and base_price > price else regular_price
        stock = raw.get("stock")
        quantity = int(stock) if isinstance(stock, (int, float)) and not isinstance(stock, bool) else None
        status = str(raw.get("stockStatus") or "").lower()
        image = raw.get("image")
        image_url = image.get("url") if isinstance(image, dict) else image if isinstance(image, str) else None
        return Product(
            external_id=sku,
            name=name,
            price_usd=price,
            list_price_usd=list_price,
            url=f"{BASE_URL}/producto/{slug}" if slug else BASE_URL,
            image_url=image_url,
            scraped_at=captured_at,
            category=self._category(raw),
            in_stock=status in {"instock", "in_stock", "available"} if status else None,
            available_quantity=quantity,
            brand=self._brand(raw),
            model=self._model(raw, name, sku),
            metadata={
                "remoteId": raw.get("id"), "slug": slug, "stockStatus": raw.get("stockStatus"),
                "onSale": bool(raw.get("onSale")), "categories": raw.get("categories") or [],
                "attributes": raw.get("attributes") or [],
            },
        )

    def run(self) -> list[Product]:
        unique: dict[str, Product] = {}
        page = 1
        total_pages = 1
        self.log("Iniciando extracción del catálogo público de Multimax")
        while page <= min(total_pages, self.max_pages):
            data = self.fetch_page(page)
            raw_products = data.get("products") or data.get("items") or []
            meta = data.get("meta") or data.get("pagination") or {}
            total_pages = max(1, int(meta.get("totalPages") or meta.get("total_pages") or 1))
            captured_at = datetime.now(timezone.utc)
            for raw in raw_products:
                if not isinstance(raw, dict):
                    continue
                product = self.parse_product(raw, captured_at)
                if product:
                    unique[product.external_id] = product
            self.pages_scanned += 1
            self.log(f"Página {page}/{total_pages}: {len(raw_products)} productos · {len(unique)} únicos", "ok")
            if self.progress_callback:
                self.progress_callback(len(unique), self.pages_scanned, self.logs)
            if not raw_products or page >= total_pages:
                break
            page += 1
            time.sleep(self.delay)
        if not unique:
            raise RuntimeError("Multimax respondió, pero no fue posible extraer productos")
        if total_pages > self.max_pages:
            raise RuntimeError(f"El catálogo requiere {total_pages} páginas y el límite configurado es {self.max_pages}")
        self.log(f"Extracción Multimax finalizada: {len(unique)} productos únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "scheduled")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "scheduled"
    database = Database(database_url, source_slug="multimax")
    job_id = database.create_job(trigger_type)
    scraper = MultimaxScraper(progress_callback=lambda found, pages, logs: database.update_job_progress(
        job_id, products_found=found, pages_scanned=pages, logs=logs
    ))
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        scraper.log("Guardando catálogo e histórico de Multimax en Neon")
        saved = database.save_products(job_id, products, progress_callback=lambda saved_count: database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            products_saved=saved_count, logs=scraper.logs,
        ))
        scraper.log("Actualizando homologación Multimax con DAKA")
        try:
            matching = refresh_competitor_matches(database_url, "multimax")
            scraper.log(f"Homologación actualizada: {matching['automatic']} automáticas · {matching['review']} alternativas por validar", "ok")
        except Exception as matching_error:
            scraper.log(f"El catálogo se guardó, pero falló la homologación: {type(matching_error).__name__}: {matching_error}", "warning")
        database.finish_job(job_id, status="success", products_found=len(products), products_saved=saved,
                            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs)
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución Multimax fallida: {type(exc).__name__}: {exc}", "error")
        try:
            database.finish_job(job_id, status="failed", products_found=len(products), products_saved=saved,
                                products_without_sku=0, pages_scanned=scraper.pages_scanned,
                                logs=scraper.logs, error_message=f"{type(exc).__name__}: {exc}"[:4000])
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
