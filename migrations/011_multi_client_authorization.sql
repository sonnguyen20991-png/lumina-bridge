BEGIN;

CREATE TABLE IF NOT EXISTS public.app_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  subject text NOT NULL,
  email citext,
  display_name text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_principals_provider_subject_key UNIQUE (provider, subject),
  CONSTRAINT app_principals_status_check CHECK (status IN ('active','disabled'))
);

CREATE TABLE IF NOT EXISTS public.client_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES public.app_principals(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_memberships_principal_client_key UNIQUE (principal_id, client_id),
  CONSTRAINT client_memberships_role_check CHECK (role IN ('owner','admin','manager','member','viewer')),
  CONSTRAINT client_memberships_status_check CHECK (status IN ('active','disabled'))
);

CREATE INDEX IF NOT EXISTS idx_client_memberships_client_active
  ON public.client_memberships (client_id, principal_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_client_memberships_principal_active
  ON public.client_memberships (principal_id, client_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_app_principals_email
  ON public.app_principals (lower(email::text))
  WHERE email IS NOT NULL AND status = 'active';

DROP INDEX IF EXISTS public.uq_import_jobs_idempotency_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_client_id_idempotency_key
  ON public.import_jobs (client_id, idempotency_key)
  WHERE client_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_unscoped_idempotency_key
  ON public.import_jobs (idempotency_key)
  WHERE client_id IS NULL AND idempotency_key IS NOT NULL;

GRANT SELECT ON public.app_principals, public.client_memberships
TO "lumina-bridge@lumina-staging-509411.iam";

INSERT INTO public.schema_migrations (version, description)
VALUES (
  '011',
  'Multi-client principal membership authorization and tenant-scoped import idempotency'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;
