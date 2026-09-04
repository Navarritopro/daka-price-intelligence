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


API_URL = "https://www.damascovzla.com/api/catalog_system/pub/products/search"
VENEZUELA_TZ = ZoneInfo("America/Caracas")


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


class DamascoScraper:
    def __init__(self, progress_callback=None):
        self.batch_size = 50
        self.delay = float(os.getenv("DAMASCO_DELAY_SECONDS", "0.25"))
        self.timeout = int(os.getenv("DAMASCO_TIMEOUT_SECONDS", "45"))
        self.max_products = int(os.getenv("DAMASCO_MAX_PRODUCTS", "5000"))
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

    def run(self) -> list[Product]:
        unique: dict[str, Product] = {}
        start = 0
        total = None
        self.log("Iniciando extracción del catálogo público de Damasco")
        while start < self.max_products and (total is None or start < total):
            end = start + self.batch_size - 1
            response = self.session.get(
                API_URL,
                params={"_from": start, "_to": end},
                timeout=self.timeout,
            )
            response.raise_for_status()
            raw_products = response.json()
            content_range = response.headers.get("resources", "")
            match = re.search(r"/(\d+)$", content_range)
            if match:
                total = min(int(match.group(1)), self.max_products)
            if not raw_products:
                break

            captured_at = datetime.now(timezone.utc)
            for raw in raw_products:
                items = raw.get("items") or []
                if not items:
                    continue
                item = items[0]
                offer = self._offer(item)
                reference = item.get("ean") or raw.get("productReferenceCode") or raw.get("productReference") or raw.get("productId")
                images = item.get("images") or []
                image_url = images[0].get("imageUrl") if images else None
                quantity = offer.get("AvailableQuantity")
                available = bool(offer.get("IsAvailable")) and (quantity is None or int(quantity) > 0)
                name = raw.get("productName") or item.get("nameComplete") or item.get("name") or reference
                unique[str(reference)] = Product(
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

            self.pages_scanned += 1
            self.log(f"Bloque {self.pages_scanned}: {len(raw_products)} productos · {len(unique)} únicos", "ok")
            if self.progress_callback:
                self.progress_callback(len(unique), self.pages_scanned, self.logs)
            start += len(raw_products)
            if len(raw_products) < self.batch_size:
                break
            time.sleep(self.delay)

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
    job_id = database.create_job(trigger_type)
    scraper = DamascoScraper(
        progress_callback=lambda found, pages, logs: database.update_job_progress(
            job_id, products_found=found, pages_scanned=pages, logs=logs
        )
    )
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        scraper.log("Guardando catálogo e histórico de Damasco en Neon")
        saved = database.save_products(job_id, products)
        matching = refresh_damasco_matches(database_url)
        scraper.log(
            f"Homologación actualizada: {matching['automatic']} coincidencias automáticas · "
            f"{matching['review']} pendientes de revisión",
            "ok",
        )
        database.finish_job(
            job_id, status="success", products_found=len(products), products_saved=saved,
            products_without_sku=0, pages_scanned=scraper.pages_scanned, logs=scraper.logs,
        )
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución Damasco fallida: {type(exc).__name__}: {exc}", "error")
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
