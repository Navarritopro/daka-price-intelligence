-- Corrige exclusivamente las capturas de Multimax creadas con la regla anterior.
-- El precio público quedó guardado temporalmente como precio de lista mientras
-- salePrice/precioAhorroUsd se interpretó como precio vigente.
BEGIN;

WITH corrected AS (
  UPDATE price_history ph
  SET
    price_usd = ph.list_price_usd,
    list_price_usd = NULL
  FROM products p
  JOIN sources s ON s.id = p.source_id
  WHERE ph.product_id = p.id
    AND s.slug = 'multimax'
    AND COALESCE((p.metadata ->> 'onSale')::boolean, FALSE) = TRUE
    AND ph.list_price_usd IS NOT NULL
    AND ph.price_usd IS DISTINCT FROM ph.list_price_usd
  RETURNING ph.id
)
SELECT COUNT(*) AS multimax_prices_corrected FROM corrected;

COMMIT;
