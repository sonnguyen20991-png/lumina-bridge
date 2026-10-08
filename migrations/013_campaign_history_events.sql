BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE public.campaign_history_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES public.clients(id),
 campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
 person_id uuid NOT NULL REFERENCES public.persons(id),
 actor uuid NOT NULL REFERENCES public.app_principals(id),
 action text NOT NULL CHECK(action IN ('added_from_list','participation_updated')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX campaign_history_events_person ON public.campaign_history_events(client_id,person_id,created_at DESC);
GRANT SELECT,INSERT ON public.campaign_history_events TO "lumina-bridge@lumina-staging-509411.iam";
INSERT INTO public.schema_migrations(version,description) VALUES('013','Append-only campaign participation history');
COMMIT;
