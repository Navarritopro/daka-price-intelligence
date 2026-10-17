BEGIN;

CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sources (slug, name, base_url)
VALUES ('daka', 'Tiendas Daka', 'https://tiendasdaka.com/ve/store')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

INSERT INTO sources (slug, name, base_url)
VALUES ('damasco', 'Damasco', 'https://www.damascovzla.com')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

INSERT INTO sources (slug, name, base_url)
VALUES ('multimax', 'Multimax', 'https://multimax.com.ve')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

INSERT INTO sources (slug, name, base_url)
VALUES ('ivoo', 'IVOO', 'https://www.ivoo.com')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

INSERT INTO sources (slug, name, base_url)
VALUES ('venelectronics', 'Venelectronics', 'https://venelectronics.com')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

INSERT INTO sources (slug, name, base_url)
VALUES ('soytechno', 'SoyTechno', 'https://soytechno.com')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual', 'local')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  products_found INTEGER NOT NULL DEFAULT 0,
  products_saved INTEGER NOT NULL DEFAULT 0,
  products_without_sku INTEGER NOT NULL DEFAULT 0,
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  url TEXT NOT NULL,
  image_url TEXT,
  brand TEXT,
  model TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id),
  job_id UUID NOT NULL REFERENCES scraping_jobs(id),
  price_usd NUMERIC(12,2),
  list_price_usd NUMERIC(12,2),
  scraped_at TIMESTAMPTZ NOT NULL,
  in_stock BOOLEAN,
  available_quantity INTEGER,
  UNIQUE (product_id, job_id)
);

CREATE TABLE IF NOT EXISTS product_matches (
  id BIGSERIAL PRIMARY KEY,
  daka_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('auto', 'review', 'confirmed', 'rejected')),
  match_method TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (daka_product_id, competitor_product_id)
);

CREATE TABLE IF NOT EXISTS product_match_audit (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT REFERENCES product_matches(id) ON DELETE SET NULL,
  daka_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('deactivated', 'replaced', 'restored')),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  replacement_match_id BIGINT REFERENCES product_matches(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  actor_user_id UUID,
  actor_email TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  job_id UUID NOT NULL REFERENCES scraping_jobs(id),
  old_price_usd NUMERIC(12,2) NOT NULL,
  new_price_usd NUMERIC(12,2) NOT NULL,
  change_pct NUMERIC(10,2) NOT NULL,
  emailed BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_scraped
  ON price_history (product_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_job ON price_history (job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_source_started ON scraping_jobs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_source_name ON products (source_id, name);
CREATE INDEX IF NOT EXISTS idx_products_source_brand ON products (source_id, brand);
CREATE INDEX IF NOT EXISTS idx_products_source_model ON products (source_id, model);
CREATE INDEX IF NOT EXISTS idx_alerts_source_created ON alerts (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_daka_status ON product_matches (daka_product_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_competitor_status ON product_matches (competitor_product_id, status);
CREATE INDEX IF NOT EXISTS idx_match_audit_match_created ON product_match_audit (match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_audit_actor_created ON product_match_audit (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source_status_started_cover
  ON scraping_jobs (source_id, status, started_at DESC)
  INCLUDE (id, finished_at, products_saved, products_found);
CREATE INDEX IF NOT EXISTS idx_price_history_job_product_cover
  ON price_history (job_id, product_id)
  INCLUDE (price_usd, list_price_usd, in_stock, available_quantity, scraped_at);
CREATE INDEX IF NOT EXISTS idx_price_history_product_scraped_cover
  ON price_history (product_id, scraped_at DESC)
  INCLUDE (job_id, price_usd, list_price_usd, in_stock, available_quantity);
CREATE INDEX IF NOT EXISTS idx_products_source_brand_normalized
  ON products (source_id, LOWER(BTRIM(brand)))
  WHERE brand IS NOT NULL AND BTRIM(brand) <> '';
CREATE INDEX IF NOT EXISTS idx_products_source_category_present
  ON products (source_id, category)
  WHERE category IS NOT NULL AND category <> '';
CREATE INDEX IF NOT EXISTS idx_matches_status_daka_competitor
  ON product_matches (status, daka_product_id, competitor_product_id);
CREATE INDEX IF NOT EXISTS idx_matches_status_competitor_daka
  ON product_matches (status, competitor_product_id, daka_product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_source_created_product
  ON alerts (source_id, created_at DESC, product_id);

-- Universo de Productos Daka. Estas tablas son independientes del catálogo web
-- (`products`) para conservar la trazabilidad del maestro corporativo y del inventario.
CREATE TABLE IF NOT EXISTS daka_import_batches (
  id UUID PRIMARY KEY,
  file_type TEXT NOT NULL CHECK (file_type IN ('master', 'inventory', 'price_list')),
  filename TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  effective_date DATE NOT NULL,
  period_month DATE,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  unique_skus INTEGER NOT NULL CHECK (unique_skus > 0),
  warning_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID,
  imported_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT daka_import_batches_file_date_checksum_key UNIQUE (file_type, checksum_sha256, effective_date)
);
CREATE TABLE IF NOT EXISTS daka_sku_master (
  sku TEXT PRIMARY KEY, line TEXT NOT NULL, family TEXT NOT NULL, subfamily TEXT,
  brand TEXT NOT NULL, description TEXT NOT NULL, master_present BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE, source_batch_id UUID REFERENCES daka_import_batches(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS daka_sku_card_history (
  id BIGSERIAL PRIMARY KEY, sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  period_month DATE NOT NULL, card_raw TEXT NOT NULL, company_abc CHAR(1) NOT NULL,
  line_abc CHAR(1) NOT NULL, family_abc CHAR(1) NOT NULL, gmroi NUMERIC NOT NULL,
  xyz CHAR(1) NOT NULL, rotation CHAR(1) NOT NULL, coverage CHAR(1) NOT NULL,
  affectation CHAR(1) NOT NULL, gmroi_warning BOOLEAN NOT NULL DEFAULT FALSE,
  source_batch_id UUID NOT NULL REFERENCES daka_import_batches(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, period_month)
);
CREATE TABLE IF NOT EXISTS daka_inventory_snapshots (
  id UUID PRIMARY KEY, effective_date DATE NOT NULL,
  source_batch_id UUID NOT NULL UNIQUE REFERENCES daka_import_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS daka_locations (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  location_type TEXT NOT NULL CHECK (location_type IN ('cdd', 'store')),
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS daka_inventory_by_location (
  snapshot_id UUID NOT NULL REFERENCES daka_inventory_snapshots(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES daka_locations(id), quantity_raw NUMERIC NOT NULL,
  quantity_available NUMERIC GENERATED ALWAYS AS (GREATEST(quantity_raw, 0)) STORED,
  PRIMARY KEY (snapshot_id, sku, location_id)
);
CREATE INDEX IF NOT EXISTS idx_daka_master_filters ON daka_sku_master (line, family, brand, subfamily);
CREATE INDEX IF NOT EXISTS idx_daka_master_description ON daka_sku_master USING gin (to_tsvector('simple', description));
CREATE INDEX IF NOT EXISTS idx_daka_card_period ON daka_sku_card_history (period_month DESC, sku);
CREATE INDEX IF NOT EXISTS idx_daka_inventory_snapshot_sku ON daka_inventory_by_location (snapshot_id, sku);
CREATE INDEX IF NOT EXISTS idx_daka_import_created ON daka_import_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS daka_price_snapshots (
  id UUID PRIMARY KEY, effective_date DATE NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  list_name TEXT NOT NULL DEFAULT 'base otras', version INTEGER NOT NULL CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, source_batch_id UUID NOT NULL UNIQUE REFERENCES daka_import_batches(id),
  replaced_by UUID REFERENCES daka_price_snapshots(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (effective_date, list_name, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_daka_price_snapshot_active ON daka_price_snapshots (effective_date, list_name) WHERE is_active;
CREATE TABLE IF NOT EXISTS daka_price_items (
  snapshot_id UUID NOT NULL REFERENCES daka_price_snapshots(id) ON DELETE CASCADE,
  sku TEXT NOT NULL, source_description TEXT NOT NULL, price_usd NUMERIC(12,2) NOT NULL CHECK (price_usd > 0),
  review_warning BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (snapshot_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_daka_price_items_sku ON daka_price_items (sku, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_daka_price_snapshot_date ON daka_price_snapshots (effective_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS daka_universe_matches (
  id BIGSERIAL PRIMARY KEY, sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  source_id BIGINT NOT NULL REFERENCES sources(id), competitor_product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'no_applicable', 'inactive')), reason TEXT, notes TEXT,
  actor_user_id UUID, actor_email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, source_id),
  CHECK ((status = 'confirmed' AND competitor_product_id IS NOT NULL)
    OR (status = 'no_applicable' AND competitor_product_id IS NULL AND reason IS NOT NULL)
    OR status = 'inactive')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_daka_universe_competitor_active ON daka_universe_matches (competitor_product_id)
  WHERE status = 'confirmed' AND competitor_product_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS daka_universe_match_audit (
  id BIGSERIAL PRIMARY KEY, universe_match_id BIGINT REFERENCES daka_universe_matches(id) ON DELETE SET NULL,
  sku TEXT NOT NULL, source_id BIGINT NOT NULL REFERENCES sources(id),
  action TEXT NOT NULL CHECK (action IN ('confirmed', 'replaced', 'no_applicable', 'cleared')),
  previous_value JSONB NOT NULL DEFAULT '{}'::jsonb, new_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT, notes TEXT, actor_user_id UUID, actor_email TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_daka_universe_matches_sku ON daka_universe_matches (sku, source_id);
CREATE INDEX IF NOT EXISTS idx_daka_universe_match_audit ON daka_universe_match_audit (sku, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daka_card_sku_period ON daka_sku_card_history (sku, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_daka_inventory_snapshot_date ON daka_inventory_snapshots (effective_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daka_price_active_date ON daka_price_snapshots (is_active, effective_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daka_universe_source_status_sku ON daka_universe_matches (source_id, status, sku);

COMMIT;
