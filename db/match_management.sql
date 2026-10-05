BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_match_audit_match_created
  ON product_match_audit (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_audit_actor_created
  ON product_match_audit (actor_email, created_at DESC);

COMMIT;
