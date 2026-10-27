BEGIN;

-- Solo configuración vigente. No guarda precios calculados ni historial del ajuste.
CREATE TABLE IF NOT EXISTS price_display_adjustments (
  source_slug TEXT PRIMARY KEY REFERENCES sources(slug),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  percentage INTEGER NOT NULL DEFAULT 1 CHECK (percentage BETWEEN 1 AND 100)
);

INSERT INTO price_display_adjustments (source_slug, enabled, percentage)
VALUES ('venelectronics', FALSE, 1) ON CONFLICT (source_slug) DO NOTHING;

-- Vista de lectura: las escrituras del scraping siguen en price_history.
-- NUMERIC evita errores de punto flotante y ROUND se aplica una sola vez.
CREATE OR REPLACE VIEW display_price_history AS
SELECT ph.id, ph.product_id, ph.job_id,
  CASE WHEN a.enabled THEN ROUND(ph.price_usd * (1 + a.percentage / 100.0), 2)
    ELSE ph.price_usd END AS price_usd,
  CASE WHEN a.enabled THEN ROUND(ph.list_price_usd * (1 + a.percentage / 100.0), 2)
    ELSE ph.list_price_usd END AS list_price_usd,
  ph.scraped_at, ph.in_stock, ph.available_quantity,
  ph.price_usd AS captured_price_usd,
  ph.list_price_usd AS captured_list_price_usd,
  CASE WHEN a.enabled THEN a.percentage ELSE 0 END AS adjustment_percentage
FROM price_history ph
JOIN products p ON p.id = ph.product_id
JOIN sources s ON s.id = p.source_id
LEFT JOIN price_display_adjustments a ON a.source_slug = s.slug;

COMMIT;
