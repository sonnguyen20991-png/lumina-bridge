SELECT version, description, applied_at
FROM public.schema_migrations WHERE version='011';

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('app_principals','client_memberships')
ORDER BY table_name, ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND indexname IN (
  'uq_import_jobs_client_id_idempotency_key',
  'uq_import_jobs_unscoped_idempotency_key',
  'idx_client_memberships_client_active',
  'idx_client_memberships_principal_active',
  'idx_app_principals_email'
)
ORDER BY indexname;
