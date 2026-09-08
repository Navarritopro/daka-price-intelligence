-- Fase 3: incorpora Multimax a la arquitectura multicompetidor existente.
INSERT INTO sources (slug, name, base_url, active)
VALUES ('multimax', 'Multimax', 'https://multimax.com.ve', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  active = TRUE;
