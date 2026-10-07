-- Fase 6: incorpora SoyTechno a la arquitectura multicompetidor existente.
INSERT INTO sources (slug, name, base_url, active)
VALUES ('soytechno', 'SoyTechno', 'https://soytechno.com', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  active = TRUE;
