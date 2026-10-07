-- Migración aditiva para onboarding y centro de ayuda.
-- Es segura para volver a ejecutar: no modifica el progreso ya registrado.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_users'
      AND column_name = 'onboarding_mode'
  ) THEN
    ALTER TABLE app_users ADD COLUMN onboarding_mode TEXT;
    UPDATE app_users SET onboarding_mode = 'optional';
    ALTER TABLE app_users ALTER COLUMN onboarding_mode SET DEFAULT 'automatic';
    ALTER TABLE app_users ALTER COLUMN onboarding_mode SET NOT NULL;
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_onboarding_mode_check
      CHECK (onboarding_mode IN ('automatic', 'optional'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_onboarding_progress (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tour_key TEXT NOT NULL,
  tour_version INTEGER NOT NULL DEFAULT 1 CHECK (tour_version > 0),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'dismissed', 'postponed')),
  last_step INTEGER NOT NULL DEFAULT 0 CHECK (last_step >= 0),
  next_prompt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tour_key)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user_updated
  ON app_onboarding_progress (user_id, updated_at DESC);

COMMIT;
