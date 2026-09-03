BEGIN;

CREATE TABLE IF NOT EXISTS scrape_requests (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_requests_pending
  ON scrape_requests (status, requested_at);

COMMIT;
