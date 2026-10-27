BEGIN;

-- Repara únicamente el inventario vigente afectado por la fecha fija antigua.
-- Usa la fecha original de publicación, no la fecha de ejecución de este script.
DO $$
DECLARE
  target RECORD;
  publication_date DATE;
BEGIN
  SELECT s.id, s.source_batch_id, s.effective_date, b.created_at, b.file_type
    INTO target
    FROM daka_inventory_snapshots s
    JOIN daka_import_batches b ON b.id = s.source_batch_id
    ORDER BY s.effective_date DESC, s.created_at DESC
    LIMIT 1
    FOR UPDATE OF s, b;

  IF NOT FOUND THEN
    RAISE NOTICE 'No existe inventario publicado.';
    RETURN;
  END IF;
  publication_date := (target.created_at AT TIME ZONE 'America/Caracas')::date;
  IF target.file_type <> 'inventory'
     OR target.effective_date <> DATE '2026-10-12'
     OR publication_date <= DATE '2026-10-12' THEN
    RAISE NOTICE 'El inventario vigente no requiere reparación.';
    RETURN;
  END IF;

  UPDATE daka_import_batches SET effective_date = publication_date
    WHERE id = target.source_batch_id AND file_type = 'inventory';
  UPDATE daka_inventory_snapshots SET effective_date = publication_date
    WHERE id = target.id;
  RAISE NOTICE 'Fecha del inventario corregida: %', publication_date;
END $$;

COMMIT;
