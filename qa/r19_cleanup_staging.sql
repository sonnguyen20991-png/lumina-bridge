BEGIN;
DELETE FROM public.client_memberships WHERE metadata->>'qa'='r19';
DELETE FROM public.app_principals WHERE metadata->>'qa'='r19';
DELETE FROM public.clients WHERE metadata->>'qa'='r19';
COMMIT;
