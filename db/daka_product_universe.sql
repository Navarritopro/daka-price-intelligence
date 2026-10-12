BEGIN;

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
  sku TEXT PRIMARY KEY,
  line TEXT NOT NULL,
  family TEXT NOT NULL,
  subfamily TEXT,
  brand TEXT NOT NULL,
  description TEXT NOT NULL,
  master_present BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_batch_id UUID REFERENCES daka_import_batches(id),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daka_sku_card_history (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  period_month DATE NOT NULL,
  card_raw TEXT NOT NULL,
  company_abc CHAR(1) NOT NULL,
  line_abc CHAR(1) NOT NULL,
  family_abc CHAR(1) NOT NULL,
  gmroi NUMERIC NOT NULL,
  xyz CHAR(1) NOT NULL,
  rotation CHAR(1) NOT NULL,
  coverage CHAR(1) NOT NULL,
  affectation CHAR(1) NOT NULL,
  gmroi_warning BOOLEAN NOT NULL DEFAULT FALSE,
  source_batch_id UUID NOT NULL REFERENCES daka_import_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, period_month)
);

CREATE TABLE IF NOT EXISTS daka_inventory_snapshots (
  id UUID PRIMARY KEY,
  effective_date DATE NOT NULL,
  source_batch_id UUID NOT NULL UNIQUE REFERENCES daka_import_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daka_locations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  location_type TEXT NOT NULL CHECK (location_type IN ('cdd', 'store')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daka_inventory_by_location (
  snapshot_id UUID NOT NULL REFERENCES daka_inventory_snapshots(id) ON DELETE CASCADE,
  sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES daka_locations(id),
  quantity_raw NUMERIC NOT NULL,
  quantity_available NUMERIC GENERATED ALWAYS AS (GREATEST(quantity_raw, 0)) STORED,
  PRIMARY KEY (snapshot_id, sku, location_id)
);

CREATE INDEX IF NOT EXISTS idx_daka_master_filters ON daka_sku_master (line, family, brand, subfamily);
CREATE INDEX IF NOT EXISTS idx_daka_master_description ON daka_sku_master USING gin (to_tsvector('simple', description));
CREATE INDEX IF NOT EXISTS idx_daka_card_period ON daka_sku_card_history (period_month DESC, sku);
CREATE INDEX IF NOT EXISTS idx_daka_inventory_snapshot_sku ON daka_inventory_by_location (snapshot_id, sku);
CREATE INDEX IF NOT EXISTS idx_daka_import_created ON daka_import_batches (created_at DESC);

-- Compatibilidad con instalaciones que ya tenían la restricción original.
DO $$
BEGIN
  ALTER TABLE daka_import_batches DROP CONSTRAINT IF EXISTS daka_import_batches_file_type_check;
  ALTER TABLE daka_import_batches ADD CONSTRAINT daka_import_batches_file_type_check
    CHECK (file_type IN ('master', 'inventory', 'price_list'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE daka_import_batches DROP CONSTRAINT IF EXISTS daka_import_batches_file_type_checksum_sha256_key;
  ALTER TABLE daka_import_batches DROP CONSTRAINT IF EXISTS daka_import_batches_file_type_checksum;
  ALTER TABLE daka_import_batches ADD CONSTRAINT daka_import_batches_file_date_checksum_key
    UNIQUE (file_type, checksum_sha256, effective_date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS daka_price_snapshots (
  id UUID PRIMARY KEY,
  effective_date DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  list_name TEXT NOT NULL DEFAULT 'base otras',
  version INTEGER NOT NULL CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_batch_id UUID NOT NULL UNIQUE REFERENCES daka_import_batches(id),
  replaced_by UUID REFERENCES daka_price_snapshots(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (effective_date, list_name, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daka_price_snapshot_active
  ON daka_price_snapshots (effective_date, list_name) WHERE is_active;

CREATE TABLE IF NOT EXISTS daka_price_items (
  snapshot_id UUID NOT NULL REFERENCES daka_price_snapshots(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  source_description TEXT NOT NULL,
  price_usd NUMERIC(12,2) NOT NULL CHECK (price_usd > 0),
  review_warning BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (snapshot_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_daka_price_items_sku ON daka_price_items (sku, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_daka_price_snapshot_date ON daka_price_snapshots (effective_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS daka_universe_matches (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL REFERENCES daka_sku_master(sku) ON DELETE CASCADE,
  source_id BIGINT NOT NULL REFERENCES sources(id),
  competitor_product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'no_applicable', 'inactive')),
  reason TEXT,
  notes TEXT,
  actor_user_id UUID,
  actor_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku, source_id),
  CHECK (
    (status = 'confirmed' AND competitor_product_id IS NOT NULL)
    OR (status = 'no_applicable' AND competitor_product_id IS NULL AND reason IS NOT NULL)
    OR status = 'inactive'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_daka_universe_competitor_active
  ON daka_universe_matches (competitor_product_id)
  WHERE status = 'confirmed' AND competitor_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS daka_universe_match_audit (
  id BIGSERIAL PRIMARY KEY,
  universe_match_id BIGINT REFERENCES daka_universe_matches(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  source_id BIGINT NOT NULL REFERENCES sources(id),
  action TEXT NOT NULL CHECK (action IN ('confirmed', 'replaced', 'no_applicable', 'cleared')),
  previous_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  notes TEXT,
  actor_user_id UUID,
  actor_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daka_universe_matches_sku ON daka_universe_matches (sku, source_id);
CREATE INDEX IF NOT EXISTS idx_daka_universe_match_audit ON daka_universe_match_audit (sku, source_id, created_at DESC);

COMMIT;
