BEGIN;

INSERT INTO public.clients (id, name, status, metadata)
VALUES
('a19a0000-0000-4000-8000-000000000001','R19 QA Client A','active','{"qa":"r19"}'::jsonb),
('b19b0000-0000-4000-8000-000000000002','R19 QA Client B','active','{"qa":"r19"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET status='active', name=EXCLUDED.name;

INSERT INTO public.app_principals (provider, subject, email, display_name, status, metadata)
VALUES
('staging-header','r19-owner-a@example.test','r19-owner-a@example.test','R19 Owner A','active','{"qa":"r19"}'::jsonb),
('staging-header','r19-owner-b@example.test','r19-owner-b@example.test','R19 Owner B','active','{"qa":"r19"}'::jsonb),
('staging-header','r19-viewer-a@example.test','r19-viewer-a@example.test','R19 Viewer A','active','{"qa":"r19"}'::jsonb)
ON CONFLICT (provider,subject) DO UPDATE SET status='active', email=EXCLUDED.email, display_name=EXCLUDED.display_name;

INSERT INTO public.client_memberships (principal_id, client_id, role, status, metadata)
SELECT p.id, v.client_id, v.role, 'active', '{"qa":"r19"}'::jsonb
FROM (VALUES
 ('r19-owner-a@example.test','a19a0000-0000-4000-8000-000000000001'::uuid,'owner'),
 ('r19-owner-b@example.test','b19b0000-0000-4000-8000-000000000002'::uuid,'owner'),
 ('r19-viewer-a@example.test','a19a0000-0000-4000-8000-000000000001'::uuid,'viewer')
) AS v(subject,client_id,role)
JOIN public.app_principals p ON p.provider='staging-header' AND p.subject=v.subject
ON CONFLICT (principal_id,client_id) DO UPDATE SET role=EXCLUDED.role, status='active';

COMMIT;

SELECT p.subject, cm.client_id, c.name, cm.role, cm.status
FROM public.client_memberships cm
JOIN public.app_principals p ON p.id=cm.principal_id
JOIN public.clients c ON c.id=cm.client_id
WHERE p.subject LIKE 'r19-%@example.test'
ORDER BY p.subject;
