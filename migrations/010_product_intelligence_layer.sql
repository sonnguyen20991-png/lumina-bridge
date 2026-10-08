BEGIN;

-- Revision 17/18: product intelligence layer hardening.
-- Existing tables are extended in-place; no duplicate feature tables are created.

ALTER TABLE public.saved_targets
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS source_target_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lists_source_target_id_fkey'
      AND conrelid = 'public.lists'::regclass
  ) THEN
    ALTER TABLE public.lists
      ADD CONSTRAINT lists_source_target_id_fkey
      FOREIGN KEY (source_target_id)
      REFERENCES public.saved_targets(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.export_jobs
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'export_jobs_campaign_id_fkey'
      AND conrelid = 'public.export_jobs'::regclass
  ) THEN
    ALTER TABLE public.export_jobs
      ADD CONSTRAINT export_jobs_campaign_id_fkey
      FOREIGN KEY (campaign_id)
      REFERENCES public.campaigns(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_saved_targets_client_updated
  ON public.saved_targets (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lists_client_updated
  ON public.lists (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lists_source_target
  ON public.lists (source_target_id)
  WHERE source_target_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_client_updated
  ON public.campaigns (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_participations_person_campaign
  ON public.campaign_participations (person_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_export_jobs_client_created
  ON public.export_jobs (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_jobs_list_created
  ON public.export_jobs (list_id, created_at DESC)
  WHERE list_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_campaign
  ON public.export_jobs (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_status
  ON public.export_jobs (status);

-- Runtime permissions for the product-layer tables.
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.saved_targets,
   public.lists,
   public.list_memberships,
   public.campaigns,
   public.campaign_participations,
   public.export_jobs
TO "lumina-bridge@lumina-staging-509411.iam";

-- Keep audit_events append-only for the runtime identity.
GRANT SELECT, INSERT
ON public.audit_events
TO "lumina-bridge@lumina-staging-509411.iam";

INSERT INTO public.schema_migrations (
  version,
  description
)
VALUES (
  '010',
  'Product intelligence layer for saved targets, frozen lists, campaign history and tracked exports'
)
ON CONFLICT (version)
DO NOTHING;

COMMIT;
