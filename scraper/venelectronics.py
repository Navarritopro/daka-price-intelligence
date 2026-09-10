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


BASE_URL = "https://venelectronics.com"
API_URL = os.getenv(
    "VENELECTRONICS_API_URL",
    f"{BASE_URL}/wp-json/wc/store/v1/products",
)
VENEZUELA_TZ = ZoneInfo("America/Caracas")

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


class VenelectronicsScraper:
    def __init__(self, progress_callback=None):
        self.page_size = min(max(int(os.getenv("VENELECTRONICS_PAGE_SIZE", "100")), 1), 100)
        self.delay = max(0, float(os.getenv("VENELECTRONICS_DELAY_SECONDS", "10")))
        self.timeout = int(os.getenv("VENELECTRONICS_TIMEOUT_SECONDS", "60"))
        self.max_pages = int(os.getenv("VENELECTRONICS_MAX_PAGES", "100"))
        self.retry_attempts = max(1, int(os.getenv("VENELECTRONICS_RETRY_ATTEMPTS", "3")))
        self.challenge_base_seconds = max(
            0,
            float(os.getenv("VENELECTRONICS_CHALLENGE_BASE_SECONDS", "20")),
        )
        self.logs: list[dict] = []
        self.pages_scanned = 0
        self.progress_callback = progress_callback
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "Referer": f"{BASE_URL}/",
            "User-Agent": "DAKA-Price-Lab/5.0 catalog-monitor",
        })

    def log(self, message: str, level: str = "info") -> None:
        stamp = datetime.now(timezone.utc).astimezone(VENEZUELA_TZ).strftime("[%H:%M:%S]")
        self.logs.append({"time": stamp, "level": level, "message": message})
        print(f"{stamp} {message}", flush=True)

    @staticmethod
    def _decimal_minor(value, minor_unit: int = 2) -> Decimal | None:
        if value in (None, ""):
            return None
        try:
            amount = Decimal(str(value)) / (Decimal(10) ** int(minor_unit))
            return amount.quantize(Decimal("0.01")) if amount >= 0 else None
        except Exception:
            return None

    @staticmethod
    def _model(raw: dict, name: str) -> str | None:
        attributes = raw.get("attributes") or []
        for attribute in attributes:
            label = str(attribute.get("name") or attribute.get("taxonomy") or "").lower()
            if "modelo" not in label and "model" not in label:
                continue
            terms = attribute.get("terms") or []
            value = next((str(term.get("name") or "").strip() for term in terms if term.get("name")), "")
            if value:
                return value
        tokens = sorted(model_tokens(name), key=len, reverse=True)
        return tokens[0] if tokens else None

    @staticmethod
    def _category(raw: dict, name: str) -> str | None:
        kind = product_type(name)
        if kind:
            return CATEGORY_LABELS.get(kind)
        categories = raw.get("categories") or []
        return str(categories[-1].get("name")) if categories and categories[-1].get("name") else None

    @staticmethod
    def _quantity(raw: dict) -> int | None:
        values = [raw.get("low_stock_remaining"), raw.get("stock_quantity")]
        extensions = raw.get("extensions") or {}
        values.append(extensions.get("stock_quantity") if isinstance(extensions, dict) else None)
        for value in values:
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return max(0, int(value))
        return None

    @staticmethod
    def _challenge(response: requests.Response) -> bool:
        content_type = response.headers.get("content-type", "").lower()
        preview = response.text[:800].lower() if "json" not in content_type else ""
        return response.status_code == 202 or "sg-captcha" in response.headers or "sgcaptcha" in preview

    def fetch_page(self, page: int) -> tuple[list[dict], int]:
        last_error: Exception | None = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                response = self.session.get(
                    API_URL,
                    params={"page": page, "per_page": self.page_size, "orderby": "id", "order": "asc"},
                    timeout=self.timeout,
                )
                if self._challenge(response):
                    raise RuntimeError(
                        "Venelectronics solicitó verificación anti-bot; GitHub no debe guardar una captura incompleta"
                    )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise RuntimeError("Venelectronics devolvió un catálogo con formato inesperado")
                total_pages = max(1, int(response.headers.get("X-WP-TotalPages") or 1))
                return payload, total_pages
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_error = exc
                if attempt < self.retry_attempts:
                    is_challenge = "anti-bot" in str(exc)
                    wait_seconds = self.challenge_base_seconds * attempt if is_challenge else attempt * 2
                    reason = "verificación temporal" if is_challenge else "error temporal"
                    self.log(
                        f"Página {page}: {reason}; reintento {attempt + 1}/{self.retry_attempts} "
                        f"en {wait_seconds:g} s",
                        "warning",
                    )
                    time.sleep(wait_seconds)
        raise RuntimeError(f"No fue posible consultar la página {page}: {last_error}") from last_error

    def parse_product(self, raw: dict, captured_at: datetime) -> Product | None:
        product_id = str(raw.get("id") or "").strip()
        sku = str(raw.get("sku") or product_id).strip()
        name = str(raw.get("name") or "").strip()
        if not product_id or not name:
            return None
        prices = raw.get("prices") or {}
        currency = str(prices.get("currency_code") or "USD").upper()
        if currency != "USD":
            raise RuntimeError(f"Venelectronics devolvió una moneda inesperada para {sku}: {currency}")
        minor_unit = int(prices.get("currency_minor_unit") or 2)
        price = self._decimal_minor(prices.get("price"), minor_unit)
        regular = self._decimal_minor(prices.get("regular_price"), minor_unit)
        sale = self._decimal_minor(prices.get("sale_price"), minor_unit)
        list_price = regular if regular is not None and price is not None and regular > price else None
        quantity = self._quantity(raw)
        in_stock = raw.get("is_in_stock")
        images = raw.get("images") or []
        image_url = images[0].get("src") if images and isinstance(images[0], dict) else None
        categories = [item.get("name") for item in (raw.get("categories") or []) if item.get("name")]
        return Product(
            external_id=sku,
            name=name,
            price_usd=price,
            list_price_usd=list_price,
            url=str(raw.get("permalink") or f"{BASE_URL}/producto/{raw.get('slug', '')}/"),
            image_url=image_url,
            scraped_at=captured_at,
            category=self._category(raw, name),
            in_stock=bool(in_stock) if isinstance(in_stock, bool) else None,
            available_quantity=quantity,
            brand=infer_brand(name),
            model=self._model(raw, name),
            metadata={
                "remoteId": raw.get("id"), "slug": raw.get("slug"), "categories": categories,
                "currency": currency, "publicPriceMinor": prices.get("price"),
                "regularPriceMinor": prices.get("regular_price"),
                "salePriceMinor": prices.get("sale_price"), "parsedSalePrice": str(sale) if sale is not None else None,
                "pricingRule": "woocommerce_public_price", "catalogVisibility": raw.get("catalog_visibility"),
            },
        )

    def run(self, *, sample_pages: int | None = None) -> list[Product]:
        unique: dict[str, Product] = {}
        page = 1
        total_pages = 1
        page_limit = sample_pages if sample_pages is not None else self.max_pages
        self.log("Iniciando extracción del catálogo público de Venelectronics")
        while page <= min(total_pages, page_limit):
            raw_products, total_pages = self.fetch_page(page)
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
            raise RuntimeError("Venelectronics respondió, pero no fue posible extraer productos")
        if sample_pages is None and total_pages > self.max_pages:
            raise RuntimeError(f"El catálogo requiere {total_pages} páginas y el límite configurado es {self.max_pages}")
        self.log(f"Extracción Venelectronics finalizada: {len(unique)} productos únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "scheduled")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "scheduled"
    database = Database(database_url, source_slug="venelectronics")
    if trigger_type == "scheduled" and database.has_successful_job_today():
        print("[OMITIDO] Venelectronics ya tiene una captura exitosa de hoy en hora de Venezuela.", flush=True)
        return 0
    job_id = database.create_job(trigger_type)
    scraper = VenelectronicsScraper(progress_callback=lambda found, pages, logs: database.update_job_progress(
        job_id, products_found=found, pages_scanned=pages, logs=logs))
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        scraper.log("Guardando catálogo e histórico de Venelectronics en Neon")
        saved = database.save_products(job_id, products, progress_callback=lambda saved_count: database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            products_saved=saved_count, logs=scraper.logs))
        scraper.log("Actualizando homologación Venelectronics con DAKA")
        try:
            matching = refresh_competitor_matches(database_url, "venelectronics")
            scraper.log(f"Homologación actualizada: {matching['automatic']} automáticas · {matching['review']} alternativas por validar", "ok")
        except Exception as matching_error:
            scraper.log(f"El catálogo se guardó, pero falló la homologación: {type(matching_error).__name__}: {matching_error}", "warning")
        database.finish_job(job_id, status="success", products_found=len(products), products_saved=saved,
                            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs)
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución Venelectronics fallida: {type(exc).__name__}: {exc}", "error")
        try:
            database.finish_job(job_id, status="failed", products_found=len(products), products_saved=saved,
                                products_without_sku=0, pages_scanned=scraper.pages_scanned,
                                logs=scraper.logs, error_message=f"{type(exc).__name__}: {exc}"[:4000])
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
