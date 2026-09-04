from __future__ import annotations

import json
import uuid
from decimal import Decimal
from typing import Iterable

import psycopg
from psycopg.rows import dict_row


class Database:
    def __init__(self, database_url: str, source_slug: str = "daka"):
        self.database_url = database_url
        self.source_slug = source_slug

    def _connect(self):
        return psycopg.connect(self.database_url, row_factory=dict_row)

    def create_job(self, trigger_type: str) -> str:
        job_id = str(uuid.uuid4())
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scraping_jobs (id, source_id, trigger_type, status)
                SELECT %s, id, %s, 'running' FROM sources WHERE slug = %s
                """,
                (job_id, trigger_type, self.source_slug),
            )
        return job_id

    def update_job_progress(self, job_id: str, *, products_found: int,
                            pages_scanned: int, logs: list[dict],
                            products_saved: int | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE scraping_jobs SET
                  products_found = %s,
                  pages_scanned = %s,
                  products_saved = COALESCE(%s, products_saved),
                  logs = %s::jsonb
                WHERE id = %s AND status = 'running'
                """,
                (products_found, pages_scanned, products_saved,
                 json.dumps(logs, ensure_ascii=False), job_id),
            )

    def save_products(self, job_id: str, products: Iterable,
                      progress_callback=None) -> int:
        saved = 0
        with self._connect() as conn:
            source_row = conn.execute(
                "SELECT id FROM sources WHERE slug = %s", (self.source_slug,)
            ).fetchone()
            if not source_row:
                raise RuntimeError(f"La fuente {self.source_slug!r} no existe en sources")
            source_id = source_row["id"]
            for product in products:
                if not product.external_id:
                    continue
                row = conn.execute(
                    """
                    INSERT INTO products
                      (source_id, external_id, name, category, url, image_url, brand,
                       model, metadata, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (source_id, external_id) DO UPDATE SET
                      name = EXCLUDED.name,
                      category = COALESCE(EXCLUDED.category, products.category),
                      url = EXCLUDED.url,
                      image_url = EXCLUDED.image_url,
                      brand = COALESCE(EXCLUDED.brand, products.brand),
                      model = COALESCE(EXCLUDED.model, products.model),
                      metadata = products.metadata || EXCLUDED.metadata,
                      active = TRUE,
                      last_seen_at = EXCLUDED.last_seen_at
                    RETURNING id
                    """,
                    (source_id, product.external_id, product.name, product.category,
                     product.url, product.image_url, getattr(product, "brand", None),
                     getattr(product, "model", None),
                     json.dumps(getattr(product, "metadata", {}) or {}, ensure_ascii=False),
                     product.scraped_at),
                ).fetchone()
                conn.execute(
                    """
                    INSERT INTO price_history
                      (product_id, job_id, price_usd, scraped_at, in_stock,
                       list_price_usd, available_quantity)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (product_id, job_id) DO UPDATE SET
                      price_usd = EXCLUDED.price_usd,
                      scraped_at = EXCLUDED.scraped_at,
                      in_stock = EXCLUDED.in_stock,
                      list_price_usd = EXCLUDED.list_price_usd,
                      available_quantity = EXCLUDED.available_quantity
                    """,
                    (row["id"], job_id, product.price_usd, product.scraped_at,
                     product.in_stock, getattr(product, "list_price_usd", None),
                     getattr(product, "available_quantity", None)),
                )
                saved += 1
                if progress_callback and saved % 100 == 0:
                    progress_callback(saved)
        return saved

    def create_alerts(self, job_id: str, threshold_percent: Decimal) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                WITH current_prices AS (
                  SELECT ph.product_id, ph.price_usd AS new_price, ph.scraped_at
                  FROM price_history ph
                  WHERE ph.job_id = %s AND ph.price_usd IS NOT NULL
                ), comparisons AS (
                  SELECT cp.product_id, cp.new_price,
                    previous.price_usd AS old_price,
                    ROUND(((cp.new_price - previous.price_usd) / NULLIF(previous.price_usd, 0)) * 100, 2) AS change_pct
                  FROM current_prices cp
                  JOIN LATERAL (
                    SELECT ph.price_usd
                    FROM price_history ph
                    WHERE ph.product_id = cp.product_id
                      AND ph.job_id <> %s
                      AND ph.scraped_at < cp.scraped_at
                      AND ph.price_usd IS NOT NULL
                    ORDER BY ph.scraped_at DESC
                    LIMIT 1
                  ) previous ON TRUE
                )
                INSERT INTO alerts
                  (source_id, product_id, job_id, old_price_usd, new_price_usd, change_pct)
                SELECT p.source_id, c.product_id, %s, c.old_price, c.new_price, c.change_pct
                FROM comparisons c
                JOIN products p ON p.id = c.product_id
                WHERE ABS(c.change_pct) >= %s
                ON CONFLICT (product_id, job_id) DO UPDATE SET
                  old_price_usd = EXCLUDED.old_price_usd,
                  new_price_usd = EXCLUDED.new_price_usd,
                  change_pct = EXCLUDED.change_pct
                RETURNING id, product_id, old_price_usd, new_price_usd, change_pct
                """,
                (job_id, job_id, job_id, threshold_percent),
            ).fetchall()
            if not rows:
                return []
            product_ids = [row["product_id"] for row in rows]
            products = conn.execute(
                "SELECT id, external_id, name, url FROM products WHERE id = ANY(%s)",
                (product_ids,),
            ).fetchall()
            product_by_id = {row["id"]: row for row in products}
            return [{**row, **product_by_id[row["product_id"]]} for row in rows]

    def update_alert_channels(self, alert_ids: list[int], emailed: bool, telegram_sent: bool) -> None:
        if not alert_ids:
            return
        with self._connect() as conn:
            conn.execute(
                "UPDATE alerts SET emailed = %s, telegram_sent = %s WHERE id = ANY(%s)",
                (emailed, telegram_sent, alert_ids),
            )

    def finish_job(self, job_id: str, *, status: str, products_found: int = 0,
                   products_saved: int = 0, products_without_sku: int = 0,
                   pages_scanned: int = 0, logs: list[dict] | None = None,
                   error_message: str | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE scraping_jobs SET
                  status = %s,
                  finished_at = NOW(),
                  products_found = %s,
                  products_saved = %s,
                  products_without_sku = %s,
                  pages_scanned = %s,
                  logs = %s::jsonb,
                  error_message = %s
                WHERE id = %s
                """,
                (status, products_found, products_saved, products_without_sku,
                 pages_scanned, json.dumps(logs or [], ensure_ascii=False),
                 error_message, job_id),
            )
