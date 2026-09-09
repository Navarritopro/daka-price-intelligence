-- Fase 5: incorpora Venelectronics a la arquitectura multicompetidor existente.
INSERT INTO sources (slug, name, base_url, active)
VALUES ('venelectronics', 'Venelectronics', 'https://venelectronics.com', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  active = TRUE;
