-- Bloque 5: índices aditivos para las consultas de lectura más frecuentes.
-- CONCURRENTLY evita bloquear las escrituras del scraping mientras se construyen.
SET statement_timeout = '15min';
SET lock_timeout = '5s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_source_status_started_cover
  ON scraping_jobs (source_id, status, started_at DESC)
  INCLUDE (id, finished_at, products_saved, products_found);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_history_job_product_cover
  ON price_history (job_id, product_id)
  INCLUDE (price_usd, list_price_usd, in_stock, available_quantity, scraped_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_history_product_scraped_cover
  ON price_history (product_id, scraped_at DESC)
  INCLUDE (job_id, price_usd, list_price_usd, in_stock, available_quantity);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_source_brand_normalized
  ON products (source_id, LOWER(BTRIM(brand)))
  WHERE brand IS NOT NULL AND BTRIM(brand) <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_source_category_present
  ON products (source_id, category)
  WHERE category IS NOT NULL AND category <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_status_daka_competitor
  ON product_matches (status, daka_product_id, competitor_product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_status_competitor_daka
  ON product_matches (status, competitor_product_id, daka_product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_source_created_product
  ON alerts (source_id, created_at DESC, product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daka_card_sku_period
  ON daka_sku_card_history (sku, period_month DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daka_inventory_snapshot_date
  ON daka_inventory_snapshots (effective_date DESC, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daka_price_active_date
  ON daka_price_snapshots (is_active, effective_date DESC, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daka_universe_source_status_sku
  ON daka_universe_matches (source_id, status, sku);

ANALYZE scraping_jobs;
ANALYZE products;
ANALYZE price_history;
ANALYZE product_matches;
ANALYZE alerts;
ANALYZE daka_sku_master;
ANALYZE daka_sku_card_history;
ANALYZE daka_inventory_snapshots;
ANALYZE daka_inventory_by_location;
ANALYZE daka_price_snapshots;
ANALYZE daka_price_items;
ANALYZE daka_universe_matches;
