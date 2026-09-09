-- Fase 4: incorpora IVOO a la arquitectura multicompetidor existente.
INSERT INTO sources (slug, name, base_url, active)
VALUES ('ivoo', 'IVOO', 'https://www.ivoo.com', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  base_url = EXCLUDED.base_url,
  active = TRUE;
