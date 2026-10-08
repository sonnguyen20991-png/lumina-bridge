BEGIN;

SET LOCAL lock_timeout = '10s';

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_targets_client_normalized_name
ON public.saved_targets (
  client_id,
  lower(btrim(name))
);

INSERT INTO public.schema_migrations (
  version,
  description
)
VALUES (
  '014',
  'Enforce unique saved target names per client using normalized case-insensitive names'
)
ON CONFLICT (version)
DO NOTHING;

COMMIT;
