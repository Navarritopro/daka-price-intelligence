\pset pager off

SELECT
  current_database() AS database_name,
  pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT 'sources' AS entity, COUNT(*)::bigint AS records FROM sources
UNION ALL SELECT 'products', COUNT(*)::bigint FROM products
UNION ALL SELECT 'price_history', COUNT(*)::bigint FROM price_history
UNION ALL SELECT 'scraping_jobs', COUNT(*)::bigint FROM scraping_jobs
UNION ALL SELECT 'product_matches', COUNT(*)::bigint FROM product_matches
UNION ALL SELECT 'alerts', COUNT(*)::bigint FROM alerts
ORDER BY entity;

SELECT
  COUNT(*) FILTER (WHERE p.id IS NULL)::bigint AS orphan_product_history,
  COUNT(*) FILTER (WHERE j.id IS NULL)::bigint AS orphan_job_history
FROM price_history ph
LEFT JOIN products p ON p.id = ph.product_id
LEFT JOIN scraping_jobs j ON j.id = ph.job_id;

SELECT
  s.slug AS source,
  COUNT(DISTINCT p.id)::bigint AS products,
  COUNT(ph.id)::bigint AS captures,
  MAX(ph.scraped_at) AS latest_capture
FROM sources s
LEFT JOIN products p ON p.source_id = s.id
LEFT JOIN price_history ph ON ph.product_id = p.id
GROUP BY s.slug
ORDER BY s.slug;
