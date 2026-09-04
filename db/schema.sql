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

COMMIT;
