from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import requests

from database import Database
from matching import infer_brand, model_tokens, product_type, refresh_competitor_matches
from notifications import notify_failure


BASE_URL = "https://soytechno.com"
API_URL = os.getenv("SOYTECHNO_API_URL", f"{BASE_URL}/wp-json/wc/store/v1/products")
VENEZUELA_TZ = ZoneInfo("America/Caracas")
EXCLUDED_NAMES = ("producto de prueba", "producto especial soytechno")
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


class SoyTechnoScraper:
    def __init__(self, progress_callback=None):
        self.page_size = min(max(int(os.getenv("SOYTECHNO_PAGE_SIZE", "100")), 1), 100)
        self.delay = max(0, float(os.getenv("SOYTECHNO_DELAY_SECONDS", "2")))
        self.timeout = int(os.getenv("SOYTECHNO_TIMEOUT_SECONDS", "60"))
        self.max_pages = int(os.getenv("SOYTECHNO_MAX_PAGES", "150"))
        self.retry_attempts = max(1, int(os.getenv("SOYTECHNO_RETRY_ATTEMPTS", "3")))
        self.logs: list[dict] = []
        self.pages_scanned = 0
        self.records_seen = 0
        self.progress_callback = progress_callback
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "Referer": f"{BASE_URL}/tienda-electronica-venezuela/",
            "User-Agent": "DAKA-Price-Lab/6.0 catalog-monitor",
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
            return amount.quantize(Decimal("0.01")) if amount > 0 else None
        except Exception:
            return None

    @staticmethod
    def _attribute(raw: dict, keys: tuple[str, ...]) -> str | None:
        for attribute in raw.get("attributes") or []:
            label = str(attribute.get("name") or attribute.get("taxonomy") or "").lower()
            if not any(key in label for key in keys):
                continue
            terms = attribute.get("terms") or []
            values = [str(term.get("name") or "").strip() for term in terms if term.get("name")]
            if values:
                return " / ".join(values)
        return None

    @classmethod
    def _model(cls, raw: dict, name: str) -> str | None:
        explicit = cls._attribute(raw, ("modelo", "model"))
        if explicit:
            return explicit
        tokens = sorted(model_tokens(name), key=len, reverse=True)
        return tokens[0] if tokens else None

    @staticmethod
    def _category(raw: dict, name: str) -> str | None:
        kind = product_type(name)
        if kind:
            return CATEGORY_LABELS.get(kind)
        categories = raw.get("categories") or []
        return str(categories[-1].get("name")) if categories and categories[-1].get("name") else None

    @classmethod
    def _brand(cls, raw: dict, name: str) -> str | None:
        brands = raw.get("brands") or []
        if brands and isinstance(brands[0], dict) and brands[0].get("name"):
            return str(brands[0]["name"]).strip()
        explicit = cls._attribute(raw, ("marca", "brand"))
        return explicit or infer_brand(name)

    @staticmethod
    def _quantity(raw: dict) -> int | None:
        values = [raw.get("low_stock_remaining"), raw.get("stock_quantity")]
        extensions = raw.get("extensions") or {}
        if isinstance(extensions, dict):
            values.append(extensions.get("stock_quantity"))
        for value in values:
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return max(0, int(value))
        return None

    @staticmethod
    def _parent_id(raw: dict) -> int | None:
        for key in ("parent_id", "parent"):
            value = raw.get(key)
            if isinstance(value, int) and value > 0:
                return value
        links = raw.get("_links") or {}
        for item in links.get("up") or []:
            match = re.search(r"/products/(\d+)", str(item.get("href") or ""))
            if match:
                return int(match.group(1))
        return None

    @staticmethod
    def _excluded(name: str) -> bool:
        normalized = " ".join(name.lower().split())
        return any(value in normalized for value in EXCLUDED_NAMES)

    def fetch_page(self, page: int, *, product_type_filter: str | None = None) -> tuple[list[dict], int]:
        params: dict[str, object] = {"page": page, "per_page": self.page_size, "orderby": "id", "order": "asc"}
        if product_type_filter:
            params["type"] = product_type_filter
        last_error: Exception | None = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                response = self.session.get(API_URL, params=params, timeout=self.timeout)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise RuntimeError("SoyTechno devolvió un catálogo con formato inesperado")
                total_pages = max(1, int(response.headers.get("X-WP-TotalPages") or 1))
                return payload, total_pages
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_error = exc
                if attempt < self.retry_attempts:
                    wait_seconds = attempt * 3
                    self.log(f"Página {page}: error temporal; reintento {attempt + 1}/{self.retry_attempts} en {wait_seconds} s", "warning")
                    time.sleep(wait_seconds)
        raise RuntimeError(f"No fue posible consultar la página {page}: {last_error}") from last_error

    def parse_product(self, raw: dict, captured_at: datetime, *, is_variation: bool = False,
                      homologation_eligible: bool = True) -> Product | None:
        product_id = str(raw.get("id") or "").strip()
        sku = str(raw.get("sku") or "").strip()
        name = str(raw.get("name") or "").strip()
        if not product_id or not name or self._excluded(name):
            return None
        if is_variation and not sku:
            return None
        variation = str(raw.get("variation") or "").strip()
        display_name = name if not variation or variation.lower() in name.lower() else f"{name} · {variation}"
        prices = raw.get("prices") or {}
        currency = str(prices.get("currency_code") or "USD").upper()
        if currency != "USD":
            raise RuntimeError(f"SoyTechno devolvió una moneda inesperada para {sku or product_id}: {currency}")
        minor_unit = int(prices.get("currency_minor_unit") or 2)
        price = self._decimal_minor(prices.get("price"), minor_unit)
        if price is None:
            return None
        regular = self._decimal_minor(prices.get("regular_price"), minor_unit)
        sale = self._decimal_minor(prices.get("sale_price"), minor_unit)
        list_price = regular if regular is not None and regular > price else None
        quantity = self._quantity(raw)
        in_stock = raw.get("is_in_stock")
        images = raw.get("images") or []
        image_url = images[0].get("src") if images and isinstance(images[0], dict) else None
        categories = [item.get("name") for item in (raw.get("categories") or []) if item.get("name")]
        return Product(
            external_id=sku or f"soytechno-{product_id}", name=display_name, price_usd=price,
            list_price_usd=list_price, url=str(raw.get("permalink") or f"{BASE_URL}/?p={product_id}"),
            image_url=image_url, scraped_at=captured_at, category=self._category(raw, display_name),
            in_stock=bool(in_stock) if isinstance(in_stock, bool) else None,
            available_quantity=quantity, brand=self._brand(raw, display_name),
            model=self._model(raw, display_name),
            metadata={
                "remoteId": raw.get("id"), "parentId": self._parent_id(raw), "slug": raw.get("slug"),
                "variation": variation or None, "isVariation": is_variation,
                "homologationEligible": homologation_eligible, "categories": categories,
                "currency": currency, "publicPriceMinor": prices.get("price"),
                "regularPriceMinor": prices.get("regular_price"), "salePriceMinor": prices.get("sale_price"),
                "parsedSalePrice": str(sale) if sale is not None else None,
                "pricingRule": "woocommerce_public_price",
            },
        )

    def _fetch_collection(self, *, product_type_filter: str | None = None,
                          sample_pages: int | None = None) -> tuple[list[dict], int]:
        rows: list[dict] = []
        page, total_pages = 1, 1
        page_limit = sample_pages if sample_pages is not None else self.max_pages
        while page <= min(total_pages, page_limit):
            page_rows, total_pages = self.fetch_page(page, product_type_filter=product_type_filter)
            rows.extend(item for item in page_rows if isinstance(item, dict))
            self.pages_scanned += 1
            self.records_seen += len(page_rows)
            label = "variaciones" if product_type_filter == "variation" else "productos"
            self.log(f"Página {page}/{total_pages} de {label}: {len(page_rows)} registros", "ok")
            if self.progress_callback:
                self.progress_callback(self.records_seen, self.pages_scanned, self.logs)
            if not page_rows or page >= total_pages or page >= page_limit:
                break
            page += 1
            time.sleep(self.delay)
        if sample_pages is None and total_pages > self.max_pages:
            raise RuntimeError(f"El catálogo requiere {total_pages} páginas y el límite configurado es {self.max_pages}")
        return rows, total_pages

    def run(self, *, sample_pages: int | None = None) -> list[Product]:
        self.log("Iniciando extracción del catálogo público de SoyTechno")
        base_rows, _ = self._fetch_collection(sample_pages=sample_pages)
        variation_rows, _ = self._fetch_collection(product_type_filter="variation", sample_pages=sample_pages)
        captured_at = datetime.now(timezone.utc)
        unique: dict[str, Product] = {}
        variation_parent_ids = {parent for raw in variation_rows if (parent := self._parent_id(raw)) is not None and raw.get("sku")}
        for raw in variation_rows:
            product = self.parse_product(raw, captured_at, is_variation=True)
            if product:
                unique[product.external_id] = product
        for raw in base_rows:
            remote_id = raw.get("id")
            if remote_id in variation_parent_ids:
                continue
            ambiguous_parent = bool(raw.get("has_options") or str(raw.get("type") or "").lower() == "variable")
            product = self.parse_product(raw, captured_at, homologation_eligible=not ambiguous_parent)
            if product:
                unique[product.external_id] = product
        if not unique:
            raise RuntimeError("SoyTechno respondió, pero no fue posible extraer productos válidos")
        self.log(f"Extracción SoyTechno finalizada: {len(unique)} productos y variantes únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "scheduled")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "scheduled"
    database = Database(database_url, source_slug="soytechno")
    try:
        if trigger_type == "scheduled" and database.has_successful_job_today():
            print("[OMITIDO] SoyTechno ya tiene una captura exitosa de hoy en hora de Venezuela.", flush=True)
            return 0
        job_id = database.create_job(trigger_type)
    except Exception as exc:
        print(f"No se pudo iniciar SoyTechno: {type(exc).__name__}: {exc}", file=sys.stderr)
        notify_failure("SoyTechno", exc, trigger_type)
        return 1
    scraper = SoyTechnoScraper(progress_callback=lambda found, pages, logs: database.update_job_progress(
        job_id, products_found=found, pages_scanned=pages, logs=logs))
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        scraper.log("Guardando catálogo e histórico de SoyTechno en PostgreSQL")
        saved = database.save_products(job_id, products, progress_callback=lambda saved_count: database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            products_saved=saved_count, logs=scraper.logs))
        scraper.log("Actualizando homologación SoyTechno con DAKA")
        try:
            matching = refresh_competitor_matches(database_url, "soytechno")
            scraper.log(f"Homologación actualizada: {matching['automatic']} automáticas · {matching['review']} alternativas por validar", "ok")
        except Exception as matching_error:
            scraper.log(f"El catálogo se guardó, pero falló la homologación: {type(matching_error).__name__}: {matching_error}", "warning")
        database.finish_job(job_id, status="success", products_found=len(products), products_saved=saved,
                            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs)
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución SoyTechno fallida: {type(exc).__name__}: {exc}", "error")
        channels = notify_failure("SoyTechno", exc, trigger_type)
        if any(channels.values()):
            scraper.log("Alerta de fallo enviada", "warning")
        try:
            database.finish_job(job_id, status="failed", products_found=len(products), products_saved=saved,
                                products_without_sku=0, pages_scanned=scraper.pages_scanned,
                                logs=scraper.logs, error_message=f"{type(exc).__name__}: {exc}"[:4000])
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
