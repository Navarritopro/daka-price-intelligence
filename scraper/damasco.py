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
from matching import model_tokens, refresh_damasco_matches
from notifications import notify_failure


API_URL = "https://www.damascovzla.com/api/catalog_system/pub/products/search"
CATEGORY_TREE_URL = "https://www.damascovzla.com/api/catalog_system/pub/category/tree/{levels}"
VENEZUELA_TZ = ZoneInfo("America/Caracas")
VTEX_SEARCH_LIMIT = 2500


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


@dataclass(frozen=True)
class Category:
    path: str
    name: str


class DamascoScraper:
    def __init__(self, progress_callback=None):
        self.batch_size = 50
        self.delay = float(os.getenv("DAMASCO_DELAY_SECONDS", "0.25"))
        self.timeout = int(os.getenv("DAMASCO_TIMEOUT_SECONDS", "45"))
        self.retry_attempts = max(1, int(os.getenv("DAMASCO_RETRY_ATTEMPTS", "3")))
        self.retry_base_seconds = float(os.getenv("DAMASCO_RETRY_BASE_SECONDS", "3"))
        self.max_products = int(os.getenv("DAMASCO_MAX_PRODUCTS", "20000"))
        self.category_levels = max(1, int(os.getenv("DAMASCO_CATEGORY_LEVELS", "10")))
        self.logs: list[dict] = []
        self.pages_scanned = 0
        self.progress_callback = progress_callback
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "DAKA-Price-Lab/2.0 catalog-monitor",
        })

    def log(self, message: str, level: str = "info") -> None:
        stamp = datetime.now(timezone.utc).astimezone(VENEZUELA_TZ).strftime("[%H:%M:%S]")
        self.logs.append({"time": stamp, "level": level, "message": message})
        print(f"{stamp} {message}", flush=True)

    @staticmethod
    def _offer(item: dict) -> dict:
        sellers = item.get("sellers") or []
        default = next((seller for seller in sellers if seller.get("sellerDefault")), sellers[0] if sellers else {})
        return default.get("commertialOffer") or {}

    @staticmethod
    def _category(raw: dict) -> str | None:
        categories = raw.get("categories") or []
        if not categories:
            return None
        parts = [part for part in categories[0].split("/") if part]
        return parts[-1] if parts else None

    @staticmethod
    def _model(name: str) -> str | None:
        tokens = sorted(model_tokens(name), key=len, reverse=True)
        return tokens[0] if tokens else None

    @staticmethod
    def _decimal(value) -> Decimal | None:
        if value is None:
            return None
        return Decimal(str(value)).quantize(Decimal("0.01"))

    def _request_json(self, url: str, params: dict | None, label: str):
        """Fetch JSON while retrying only transient transport/server failures."""
        last_error: Exception | None = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                response = self.session.get(
                    url,
                    params=params,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                return response, response.json()
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_error = exc
                status = getattr(getattr(exc, "response", None), "status_code", None)
                retryable = (
                    status is None
                    or status in {408, 425, 429}
                    or 500 <= status <= 599
                )
                if not retryable:
                    raise RuntimeError(
                        f"Damasco rechazó {label.lower()} con HTTP {status}: {exc}"
                    ) from exc
                if attempt >= self.retry_attempts:
                    break
                wait_seconds = self.retry_base_seconds * attempt
                detail = f"HTTP {status}" if status else type(exc).__name__
                self.log(
                    f"{label}: {detail}; reintento "
                    f"{attempt + 1}/{self.retry_attempts} en {wait_seconds:g} s",
                    "warning",
                )
                time.sleep(wait_seconds)
        raise RuntimeError(
            f"No fue posible consultar {label.lower()} después de "
            f"{self.retry_attempts} intentos: {last_error}"
        ) from last_error

    def fetch_block(self, start: int, end: int, category_path: str | None = None):
        """Fetch one VTEX range, optionally constrained to a category path."""
        params: dict[str, str | int] = {"_from": start, "_to": end}
        if category_path:
            params["fq"] = f"C:{category_path}"
        response, payload = self._request_json(
            API_URL,
            params,
            f"Bloque {start}-{end}",
        )
        if not isinstance(payload, list):
            raise RuntimeError("Damasco devolvió un bloque con formato inesperado")
        return response, payload

    @classmethod
    def _leaf_categories(
        cls,
        nodes: list[dict],
        parent_ids: tuple[str, ...] = (),
        parent_names: tuple[str, ...] = (),
    ) -> list[Category]:
        leaves: list[Category] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            raw_id = node.get("id") if node.get("id") is not None else node.get("Id")
            if raw_id is None:
                continue
            category_id = str(raw_id)
            category_name = str(node.get("name") or node.get("Name") or category_id)
            category_ids = (*parent_ids, category_id)
            category_names = (*parent_names, category_name)
            raw_children = node.get("children")
            if raw_children is None:
                raw_children = node.get("Children")
            children = raw_children if isinstance(raw_children, list) else []
            if children:
                leaves.extend(cls._leaf_categories(children, category_ids, category_names))
                continue
            leaves.append(Category(
                path=f"/{'/'.join(category_ids)}/",
                name=" > ".join(category_names),
            ))
        return leaves

    def fetch_categories(self) -> list[Category]:
        _, payload = self._request_json(
            CATEGORY_TREE_URL.format(levels=self.category_levels),
            None,
            "Árbol de categorías",
        )
        if not isinstance(payload, list):
            raise RuntimeError("Damasco devolvió un árbol de categorías con formato inesperado")
        categories = self._leaf_categories(payload)
        unique_categories = list({category.path: category for category in categories}.values())
        if not unique_categories:
            raise RuntimeError("Damasco no devolvió categorías finales para extraer el catálogo")
        return unique_categories

    @staticmethod
    def _range_total(response) -> int | None:
        content_range = (
            response.headers.get("resources")
            or response.headers.get("REST-Content-Range")
            or response.headers.get("Content-Range")
            or ""
        )
        match = re.search(r"/(\d+)$", content_range)
        return int(match.group(1)) if match else None

    def _product(self, raw: dict, captured_at: datetime) -> Product | None:
        items = raw.get("items") or []
        if not items:
            return None
        item = items[0]
        offer = self._offer(item)
        reference = (
            item.get("ean")
            or raw.get("productReferenceCode")
            or raw.get("productReference")
            or raw.get("productId")
        )
        if reference is None:
            return None
        images = item.get("images") or []
        image_url = images[0].get("imageUrl") if images else None
        quantity = offer.get("AvailableQuantity")
        available = bool(offer.get("IsAvailable")) and (quantity is None or int(quantity) > 0)
        name = raw.get("productName") or item.get("nameComplete") or item.get("name") or reference
        return Product(
            external_id=str(reference),
            name=name,
            price_usd=self._decimal(offer.get("Price")),
            list_price_usd=self._decimal(offer.get("ListPrice")),
            url=raw.get("link") or f"https://www.damascovzla.com/{raw.get('linkText', '')}/p",
            image_url=image_url,
            scraped_at=captured_at,
            category=self._category(raw),
            in_stock=available,
            available_quantity=int(quantity) if quantity is not None else None,
            brand=raw.get("brand"),
            model=self._model(name),
            metadata={
                "productId": raw.get("productId"),
                "itemId": item.get("itemId"),
                "categories": raw.get("categories") or [],
            },
        )

    def run(self) -> list[Product]:
        unique: dict[str, Product] = {}
        self.log("Iniciando extracción del catálogo público de Damasco")
        categories = self.fetch_categories()
        self.log(f"Árbol de categorías cargado: {len(categories)} categorías finales", "ok")

        for category_number, category in enumerate(categories, start=1):
            self.log(
                f"Categoría {category_number}/{len(categories)}: {category.name}",
                "info",
            )
            start = 0
            total: int | None = None
            category_pages = 0

            while start < VTEX_SEARCH_LIMIT and (total is None or start < total):
                end = min(start + self.batch_size - 1, VTEX_SEARCH_LIMIT - 1)
                response, raw_products = self.fetch_block(start, end, category.path)
                reported_total = self._range_total(response)
                if reported_total is not None:
                    total = reported_total
                if not raw_products:
                    break

                captured_at = datetime.now(timezone.utc)
                for raw in raw_products:
                    product = self._product(raw, captured_at)
                    if product is not None:
                        unique[product.external_id] = product

                self.pages_scanned += 1
                category_pages += 1
                self.log(
                    f"Categoría {category_number}/{len(categories)} · bloque {category_pages}: "
                    f"{len(raw_products)} productos · {len(unique)} únicos totales",
                    "ok",
                )
                if len(unique) > self.max_products:
                    raise RuntimeError(
                        f"Damasco superó el límite operativo de {self.max_products} productos. "
                        "Aumente DAMASCO_MAX_PRODUCTS después de validar el volumen esperado."
                    )
                if self.progress_callback:
                    self.progress_callback(len(unique), self.pages_scanned, self.logs)
                start += len(raw_products)
                if len(raw_products) < self.batch_size:
                    break
                if total is not None and start >= total:
                    break
                time.sleep(self.delay)

            if start >= VTEX_SEARCH_LIMIT:
                raise RuntimeError(
                    f"La categoría '{category.name}' alcanzó el límite de 2500 resultados de VTEX. "
                    "La ejecución se detuvo para evitar guardar un catálogo parcial."
                )

        if not unique:
            raise RuntimeError("Damasco respondió, pero no fue posible extraer productos")
        self.log(f"Extracción Damasco finalizada: {len(unique)} productos únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "scheduled")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "scheduled"
    database = Database(database_url, source_slug="damasco")
    try:
        if trigger_type == "scheduled" and database.has_successful_job_today():
            print(
                "[OMITIDO] Damasco ya tiene una captura exitosa de hoy en hora de Venezuela.",
                flush=True,
            )
            return 0
        job_id = database.create_job(trigger_type)
    except Exception as exc:
        print(f"No se pudo iniciar Damasco: {type(exc).__name__}: {exc}", file=sys.stderr)
        notify_failure("Damasco", exc, trigger_type)
        return 1
    scraper = DamascoScraper(
        progress_callback=lambda found, pages, logs: database.update_job_progress(
            job_id, products_found=found, pages_scanned=pages, logs=logs
        )
    )
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            logs=scraper.logs,
        )
        scraper.log("Guardando catálogo e histórico de Damasco en PostgreSQL")
        saved = database.save_products(
            job_id,
            products,
            progress_callback=lambda saved_count: database.update_job_progress(
                job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
                products_saved=saved_count, logs=scraper.logs,
            ),
        )
        scraper.log("Actualizando homologación competitiva con DAKA")
        database.update_job_progress(
            job_id, products_found=len(products), pages_scanned=scraper.pages_scanned,
            products_saved=saved, logs=scraper.logs,
        )
        try:
            matching = refresh_damasco_matches(database_url)
            scraper.log(
                f"Homologación actualizada: {matching['automatic']} automáticas · "
                f"{matching['review']} candidatos por validar · "
                f"{matching['confirmed']} confirmadas",
                "ok",
            )
        except Exception as matching_error:
            scraper.log(
                f"El catálogo se guardó, pero no se pudo recalcular la homologación: "
                f"{type(matching_error).__name__}: {matching_error}",
                "warning",
            )
        database.finish_job(
            job_id, status="success", products_found=len(products), products_saved=saved,
            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs,
        )
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución Damasco fallida: {type(exc).__name__}: {exc}", "error")
        channels = notify_failure("Damasco", exc, trigger_type)
        if any(channels.values()):
            scraper.log("Alerta de fallo enviada", "warning")
        try:
            database.finish_job(
                job_id, status="failed", products_found=len(products), products_saved=saved,
                products_without_sku=0, pages_scanned=scraper.pages_scanned,
                logs=scraper.logs, error_message=f"{type(exc).__name__}: {exc}"[:4000],
            )
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
