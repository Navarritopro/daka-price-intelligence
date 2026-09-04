BEGIN;

INSERT INTO sources (slug, name, base_url)
VALUES ('damasco', 'Damasco', 'https://www.damascovzla.com')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  active = TRUE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE price_history ADD COLUMN IF NOT EXISTS list_price_usd NUMERIC(12,2);
ALTER TABLE price_history ADD COLUMN IF NOT EXISTS available_quantity INTEGER;

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

CREATE INDEX IF NOT EXISTS idx_products_source_brand ON products (source_id, brand);
CREATE INDEX IF NOT EXISTS idx_products_source_model ON products (source_id, model);
CREATE INDEX IF NOT EXISTS idx_matches_daka_status ON product_matches (daka_product_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_competitor_status ON product_matches (competitor_product_id, status);

COMMIT;
