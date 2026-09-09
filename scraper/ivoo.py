from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import requests

from database import Database
from matching import infer_brand, model_tokens, product_type, refresh_competitor_matches


GRAPHQL_URL = os.getenv("IVOO_GRAPHQL_URL", "https://nuweapp.com/graphql")
BASE_URL = "https://www.ivoo.com"
VENEZUELA_TZ = ZoneInfo("America/Caracas")
PRODUCT_QUERY = """
query GetIvooProducts($pageSize: Int!, $currentPage: Int!, $filters: ProductAttributeFilterInput!) {
  products(pageSize: $pageSize, currentPage: $currentPage, filter: $filters) {
    items {
      id name sku
      price { regularPrice { amount { currency value } } }
      small_image { url }
      url_key url_suffix
      ... on SimpleProduct { stock_breakdown { region qty } }
      ... on ConfigurableProduct { stock_breakdown { region qty } }
    }
    page_info { total_pages }
    total_count
  }
}
"""

CATEGORY_LABELS = {
    "nevera": "Neveras", "lavadora": "Lavadoras", "secadora": "Secadoras",
    "microondas": "Microondas", "aire_acondicionado": "Aires acondicionados",
    "televisor": "Televisores", "licuadora": "Licuadoras", "freidora": "Freidoras",
    "cafetera": "Cafeteras", "batidora": "Batidoras", "cocina": "Cocinas",
    "congelador": "Congeladores", "horno": "Hornos", "telefono": "Telefonía",
    "tablet": "Tablets", "laptop": "Computación", "impresora": "Impresoras",
    "ventilador": "Ventiladores", "aspiradora": "Aspiradoras", "corneta": "Audio",
    "monitor": "Monitores", "router": "Redes", "modem": "Redes",
}


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


class IvooScraper:
    def __init__(self, progress_callback=None):
        self.batch_size = int(os.getenv("IVOO_PAGE_SIZE", "50"))
        self.delay = float(os.getenv("IVOO_DELAY_SECONDS", "0.20"))
        self.timeout = int(os.getenv("IVOO_TIMEOUT_SECONDS", "60"))
        self.max_pages = int(os.getenv("IVOO_MAX_PAGES", "200"))
        self.logs: list[dict] = []
        self.pages_scanned = 0
        self.progress_callback = progress_callback
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json", "Content-Type": "application/json",
            "Origin": BASE_URL, "Referer": f"{BASE_URL}/",
            "User-Agent": "DAKA-Price-Lab/4.0 catalog-monitor",
            "store": "default", "Content-Currency": "USD",
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

    def fetch_page(self, page: int) -> dict:
        error: Exception | None = None
        payload = {"operationName": "GetIvooProducts", "query": PRODUCT_QUERY,
                   "variables": {"pageSize": self.batch_size, "currentPage": page, "filters": {}}}
        for attempt in range(1, 4):
            try:
                response = self.session.post(GRAPHQL_URL, json=payload, timeout=self.timeout)
                response.raise_for_status()
                body = response.json()
                if body.get("errors"):
                    message = "; ".join(str(item.get("message") or item) for item in body["errors"])
                    raise RuntimeError(f"GraphQL: {message}")
                products = (body.get("data") or {}).get("products")
                if not isinstance(products, dict):
                    raise RuntimeError("IVOO devolvió un catálogo con formato inesperado")
                return products
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                error = exc
                if attempt < 3:
                    self.log(f"Página {page}: reintento {attempt}/2 por {type(exc).__name__}", "warning")
                    time.sleep(attempt * 2)
        raise RuntimeError(f"No fue posible consultar la página {page}: {error}")

    @staticmethod
    def _model(name: str) -> str | None:
        tokens = sorted(model_tokens(name), key=len, reverse=True)
        return tokens[0] if tokens else None

    def parse_product(self, raw: dict, captured_at: datetime) -> Product | None:
        sku = str(raw.get("sku") or raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        if not sku or not name:
            return None
        amount = (((raw.get("price") or {}).get("regularPrice") or {}).get("amount") or {})
        price = self._decimal(amount.get("value"))
        currency = str(amount.get("currency") or "USD").upper()
        if currency != "USD":
            raise RuntimeError(f"IVOO devolvió una moneda inesperada para {sku}: {currency}")
        breakdown = raw.get("stock_breakdown") or []
        quantities = [int(item.get("qty")) for item in breakdown
                      if isinstance(item, dict) and isinstance(item.get("qty"), (int, float))
                      and not isinstance(item.get("qty"), bool)]
        quantity = sum(quantities) if quantities else None
        in_stock = quantity > 0 if quantity is not None else None
        url_key = str(raw.get("url_key") or "").strip("/")
        suffix = str(raw.get("url_suffix") or ".html")
        kind = product_type(name)
        image = raw.get("small_image") or {}
        return Product(
            external_id=sku, name=name, price_usd=price,
            url=f"{BASE_URL}/{url_key}{suffix}" if url_key else BASE_URL,
            image_url=image.get("url") if isinstance(image, dict) else None,
            scraped_at=captured_at, category=CATEGORY_LABELS.get(kind) if kind else None,
            in_stock=in_stock, brand=infer_brand(name), model=self._model(name),
            available_quantity=quantity,
            metadata={"remoteId": raw.get("id"), "currency": currency,
                      "stockBreakdown": breakdown, "pricingRule": "public_regular_price",
                      "urlKey": url_key},
        )

    def run(self, *, sample_pages: int | None = None) -> list[Product]:
        unique: dict[str, Product] = {}
        page = 1
        total_pages = 1
        page_limit = sample_pages if sample_pages is not None else self.max_pages
        self.log("Iniciando extracción del catálogo público de IVOO")
        while page <= min(total_pages, page_limit):
            data = self.fetch_page(page)
            raw_products = data.get("items") or []
            total_pages = max(1, int((data.get("page_info") or {}).get("total_pages") or 1))
            captured_at = datetime.now(timezone.utc)
            for raw in raw_products:
                if isinstance(raw, dict):
                    product = self.parse_product(raw, captured_at)
                    if product:
                        unique[product.external_id] = product
            self.pages_scanned += 1
            self.log(f"Página {page}/{total_pages}: {len(raw_products)} productos · {len(unique)} únicos", "ok")
            if self.progress_callback:
                self.progress_callback(len(unique), self.pages_scanned, self.logs)
            if not raw_products or page >= total_pages or page >= page_limit:
                break
            page += 1
            time.sleep(self.delay)
        if not unique:
            raise RuntimeError("IVOO respondió, pero no fue posible extraer productos")
        if sample_pages is None and total_pages > self.max_pages:
            raise RuntimeError(f"El catálogo requiere {total_pages} páginas y el límite configurado es {self.max_pages}")
        self.log(f"Extracción IVOO finalizada: {len(unique)} productos únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "scheduled")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "scheduled"
    database = Database(database_url, source_slug="ivoo")
    if trigger_type == "scheduled" and database.has_successful_job_today():
        print("[OMITIDO] IVOO ya tiene una captura exitosa de hoy en hora de Venezuela.", flush=True)
        return 0
    job_id = database.create_job(trigger_type)
    scraper = IvooScraper(progress_callback=lambda found, pages, logs: database.update_job_progress(
        job_id, products_found=found, pages_scanned=pages, logs=logs))
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        scraper.log("Guardando catálogo e histórico de IVOO en Neon")
        saved = database.save_products(job_id, products, progress_callback=lambda saved_count: database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            products_saved=saved_count, logs=scraper.logs))
        scraper.log("Actualizando homologación IVOO con DAKA")
        try:
            matching = refresh_competitor_matches(database_url, "ivoo")
            scraper.log(f"Homologación actualizada: {matching['automatic']} automáticas · {matching['review']} alternativas por validar", "ok")
        except Exception as matching_error:
            scraper.log(f"El catálogo se guardó, pero falló la homologación: {type(matching_error).__name__}: {matching_error}", "warning")
        database.finish_job(job_id, status="success", products_found=len(products), products_saved=saved,
                            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs)
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución IVOO fallida: {type(exc).__name__}: {exc}", "error")
        try:
            database.finish_job(job_id, status="failed", products_found=len(products), products_saved=saved,
                                products_without_sku=0, pages_scanned=scraper.pages_scanned,
                                logs=scraper.logs, error_message=f"{type(exc).__name__}: {exc}"[:4000])
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
