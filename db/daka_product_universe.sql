BEGIN;

CREATE TABLE IF NOT EXISTS daka_import_batches (
  id UUID PRIMARY KEY,
  file_type TEXT NOT NULL CHECK (file_type IN ('master', 'inventory')),
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
  UNIQUE (file_type, checksum_sha256)
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

COMMIT;
