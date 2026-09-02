from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from database import Database
from notifications import build_messages, send_email, send_telegram
from utils import extract_sap, parse_price

BASE_URL = "https://tiendasdaka.com/ve/store"
VENEZUELA_TZ = ZoneInfo("America/Caracas")


@dataclass(frozen=True)
class Product:
    external_id: str | None
    name: str
    price_usd: Decimal | None
    url: str
    image_url: str | None
    scraped_at: datetime
    category: str | None = None
    in_stock: bool | None = None


class DakaScraper:
    def __init__(self):
        self.max_pages = int(os.getenv("SCRAPER_MAX_PAGES", "200"))
        self.empty_limit = int(os.getenv("SCRAPER_EMPTY_PAGE_LIMIT", "3"))
        self.delay = float(os.getenv("SCRAPER_DELAY_SECONDS", "0.8"))
        self.logs: list[dict] = []
        self.pages_scanned = 0

    def log(self, message: str, level: str = "info") -> None:
        now = datetime.now(timezone.utc)
        stamp = now.astimezone(VENEZUELA_TZ).strftime("[%H:%M:%S]")
        self.logs.append({"time": stamp, "level": level, "message": message})
        print(f"{stamp} {message}", flush=True)

    @staticmethod
    def _page_products(page) -> list[dict]:
        return page.evaluate(
            """
            () => Array.from(document.querySelectorAll('[data-testid="product-wrapper"]')).map(wrapper => {
              const nameNode = wrapper.querySelector('span.line-clamp-2');
              const image = wrapper.querySelector('img');
              const link = wrapper.querySelector('a[href]');
              const price = wrapper.querySelector('[data-testid="price"]');
              const stockText = (wrapper.innerText || '').toLowerCase();
              return {
                name: nameNode?.innerText?.trim() || null,
                image: image?.currentSrc || image?.src || image?.getAttribute('srcset') || null,
                link: link?.getAttribute('href') || null,
                price: price?.innerText?.trim() || null,
                inStock: !stockText.includes('agotado') && !stockText.includes('sin stock')
              };
            }).filter(item => item.name && item.link)
            """
        )

    def _load_page(self, page, url: str, attempts: int = 3) -> bool:
        for attempt in range(1, attempts + 1):
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                page.wait_for_selector('[data-testid="product-wrapper"]', timeout=15_000)
                page.wait_for_timeout(800)
                return True
            except PlaywrightTimeoutError as exc:
                self.log(f"Intento {attempt} fallido en {url}: {type(exc).__name__}", "warning")
                if attempt < attempts:
                    time.sleep(attempt * 2)
        return False

    def run(self) -> list[Product]:
        unique: dict[str, Product] = {}
        empty_pages = 0
        repeated_signature_count = 0
        previous_signature = None
        self.log("Iniciando extracción de Tiendas Daka")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
            context = browser.new_context(
                user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"),
                locale="es-VE",
                timezone_id="America/Caracas",
            )
            page = context.new_page()
            for page_number in range(1, self.max_pages + 1):
                url = BASE_URL if page_number == 1 else f"{BASE_URL}?page={page_number}"
                if not self._load_page(page, url):
                    empty_pages += 1
                    if empty_pages >= self.empty_limit:
                        self.log(f"Detención por {empty_pages} páginas fallidas consecutivas", "warning")
                        break
                    continue
                raw_products = self._page_products(page)
                self.pages_scanned += 1
                if not raw_products:
                    empty_pages += 1
                    if empty_pages >= self.empty_limit:
                        self.log("Fin de catálogo detectado")
                        break
                    continue
                empty_pages = 0
                signature = (
                    len(raw_products),
                    raw_products[0].get("link"),
                    raw_products[-1].get("link"),
                )
                if signature == previous_signature:
                    repeated_signature_count += 1
                    if repeated_signature_count >= 2:
                        self.log("Fin de catálogo detectado por páginas repetidas", "warning")
                        break
                else:
                    repeated_signature_count = 0
                previous_signature = signature
                page_captured_at = datetime.now(timezone.utc)
                for raw in raw_products:
                    product_url = urljoin(BASE_URL, raw["link"])
                    image_url = urljoin(BASE_URL, raw["image"]) if raw.get("image") else None
                    sap = extract_sap(image_url, product_url)
                    dedupe_key = sap or product_url
                    unique[dedupe_key] = Product(
                        external_id=sap,
                        name=raw["name"],
                        price_usd=parse_price(raw.get("price")),
                        url=product_url,
                        image_url=image_url,
                        scraped_at=page_captured_at,
                        in_stock=raw.get("inStock"),
                    )
                self.log(f"Página {page_number}: {len(raw_products)} productos · {len(unique)} únicos", "ok")
                time.sleep(self.delay)
            context.close()
            browser.close()
        self.log(f"Extracción finalizada: {len(unique)} productos únicos", "ok")
        return list(unique.values())


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    trigger_type = os.getenv("TRIGGER_TYPE", "local")
    if trigger_type not in {"scheduled", "manual", "local"}:
        trigger_type = "local"
    threshold = Decimal(os.getenv("ALERT_THRESHOLD_PERCENT", "5"))
    database = Database(database_url)
    scraper = DakaScraper()
    job_id = database.create_job(trigger_type)
    products: list[Product] = []
    saved = 0
    try:
        products = scraper.run()
        saved = database.save_products(job_id, products)
        without_sku = sum(1 for product in products if not product.external_id)
        alerts = database.create_alerts(job_id, threshold)
        emailed = telegram_sent = False
        if alerts:
            text_message, html_message = build_messages(alerts)
            try:
                telegram_sent = send_telegram(text_message)
            except Exception as exc:  # alert failure must not invalidate captured prices
                scraper.log(f"Error en Telegram: {exc}", "warning")
            try:
                emailed = send_email(html_message, len(alerts))
            except Exception as exc:
                scraper.log(f"Error en correo: {exc}", "warning")
            database.update_alert_channels([row["id"] for row in alerts], emailed, telegram_sent)
        scraper.log(f"Histórico guardado: {saved} productos; alertas: {len(alerts)}", "ok")
        database.finish_job(
            job_id, status="success", products_found=len(products), products_saved=saved,
            products_without_sku=without_sku, pages_scanned=scraper.pages_scanned,
            logs=scraper.logs,
        )
        return 0
    except Exception as exc:
        scraper.log(f"Ejecución fallida: {type(exc).__name__}: {exc}", "error")
        try:
            database.finish_job(
                job_id, status="failed", products_found=len(products), products_saved=saved,
                products_without_sku=sum(1 for item in products if not item.external_id),
                pages_scanned=scraper.pages_scanned, logs=scraper.logs,
                error_message=f"{type(exc).__name__}: {exc}"[:4000],
            )
        except Exception as database_error:
            print(f"No se pudo registrar el fallo: {database_error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
