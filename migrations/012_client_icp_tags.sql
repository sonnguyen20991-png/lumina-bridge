BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE public.icp_definitions (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description)<=2000),
  created_by uuid NOT NULL REFERENCES public.app_principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id,id)
);
CREATE UNIQUE INDEX icp_definitions_client_name ON public.icp_definitions(client_id,lower(btrim(name)));
CREATE TABLE public.person_icp_tags (
  client_id uuid NOT NULL,
  icp_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES public.persons(id),
  assigned_by uuid NOT NULL REFERENCES public.app_principals(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id,icp_id,person_id),
  FOREIGN KEY (client_id,icp_id) REFERENCES public.icp_definitions(client_id,id)
);
CREATE INDEX person_icp_tags_client_person ON public.person_icp_tags(client_id,person_id,icp_id);
GRANT SELECT,INSERT ON public.icp_definitions TO "lumina-bridge@lumina-staging-509411.iam";
-- SELECT FOR UPDATE requires UPDATE permission even though definitions are immutable in this release.
GRANT UPDATE ON public.icp_definitions TO "lumina-bridge@lumina-staging-509411.iam";
GRANT SELECT,INSERT,DELETE ON public.person_icp_tags TO "lumina-bridge@lumina-staging-509411.iam";
INSERT INTO public.schema_migrations(version,description) VALUES('012','Client-specific manual ICP definitions and person tags');
COMMIT;
