BEGIN;

-- Living Database foundation.
--
-- Canonical person/company values continue to use the existing
-- field_observations + canonical_field_state + conflicts machinery.
--
-- These tables add:
--   1. verification-run history / scheduling
--   2. client-scoped flexible enrichment attributes

CREATE TABLE public.person_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id uuid NOT NULL
    REFERENCES public.clients(id)
    ON DELETE CASCADE,

  person_id uuid NOT NULL
    REFERENCES public.persons(id)
    ON DELETE CASCADE,

  requested_by text NOT NULL
    DEFAULT 'lumina-bridge',

  verification_type text NOT NULL,

  status text NOT NULL
    DEFAULT 'queued',

  freshness_result text,

  confidence smallint,

  scheduled_for timestamptz,

  started_at timestamptz,

  completed_at timestamptz,

  sources_checked jsonb NOT NULL
    DEFAULT '[]'::jsonb,

  summary jsonb NOT NULL
    DEFAULT '{}'::jsonb,

  metadata jsonb NOT NULL
    DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL
    DEFAULT NOW(),

  updated_at timestamptz NOT NULL
    DEFAULT NOW(),

  CONSTRAINT person_verifications_scope_key
    UNIQUE (id, client_id, person_id),

  CONSTRAINT person_verifications_type_check
    CHECK (
      verification_type IN (
        'scheduled',
        'campaign',
        'manual',
        'on_demand',
        'import_followup'
      )
    ),

  CONSTRAINT person_verifications_status_check
    CHECK (
      status IN (
        'queued',
        'running',
        'completed',
        'partial',
        'failed'
      )
    ),

  CONSTRAINT person_verifications_freshness_check
    CHECK (
      freshness_result IS NULL
      OR freshness_result IN (
        'healthy',
        'aging',
        'changed',
        'needs_review',
        'incomplete',
        'restricted',
        'unverified'
      )
    ),

  CONSTRAINT person_verifications_confidence_check
    CHECK (
      confidence IS NULL
      OR (
        confidence >= 0
        AND confidence <= 100
      )
    ),

  CONSTRAINT person_verifications_time_check
    CHECK (
      completed_at IS NULL
      OR started_at IS NULL
      OR completed_at >= started_at
    ),

  CONSTRAINT person_verifications_sources_check
    CHECK (
      jsonb_typeof(sources_checked) = 'array'
    ),

  CONSTRAINT person_verifications_summary_check
    CHECK (
      jsonb_typeof(summary) = 'object'
    ),

  CONSTRAINT person_verifications_metadata_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
    )
);

CREATE INDEX idx_person_verifications_person
  ON public.person_verifications (
    client_id,
    person_id,
    created_at DESC
  );

CREATE INDEX idx_person_verifications_schedule
  ON public.person_verifications (
    scheduled_for,
    client_id
  )
  WHERE status = 'queued';

CREATE INDEX idx_person_verifications_result
  ON public.person_verifications (
    client_id,
    freshness_result,
    completed_at DESC
  )
  WHERE completed_at IS NOT NULL;

CREATE UNIQUE INDEX uq_person_verifications_open
  ON public.person_verifications (
    client_id,
    person_id
  )
  WHERE status IN ('queued', 'running');


CREATE TABLE public.person_enrichment_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id uuid NOT NULL
    REFERENCES public.clients(id)
    ON DELETE CASCADE,

  person_id uuid NOT NULL
    REFERENCES public.persons(id)
    ON DELETE CASCADE,

  attribute_key text NOT NULL,

  attribute_label text,

  observed_value jsonb NOT NULL,

  value_type text NOT NULL
    DEFAULT 'text',

  normalized_value text,

  source_name text NOT NULL,

  confidence smallint,

  observed_at timestamptz NOT NULL
    DEFAULT NOW(),

  verification_id uuid,

  decision text NOT NULL
    DEFAULT 'observed',

  metadata jsonb NOT NULL
    DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL
    DEFAULT NOW(),

  CONSTRAINT person_enrichment_observation_key_check
    CHECK (
      attribute_key ~ '^[a-z][a-z0-9_]{0,99}$'
    ),

  CONSTRAINT person_enrichment_observation_type_check
    CHECK (
      value_type IN (
        'text',
        'number',
        'boolean',
        'date',
        'url',
        'list',
        'object'
      )
    ),

  CONSTRAINT person_enrichment_observation_confidence_check
    CHECK (
      confidence IS NULL
      OR (
        confidence >= 0
        AND confidence <= 100
      )
    ),

  CONSTRAINT person_enrichment_observation_decision_check
    CHECK (
      decision IN (
        'observed',
        'accepted',
        'kept_existing',
        'needs_review'
      )
    ),

  CONSTRAINT person_enrichment_observation_metadata_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
    ),

  CONSTRAINT person_enrichment_observation_verification_fkey
    FOREIGN KEY (
      verification_id,
      client_id,
      person_id
    )
    REFERENCES public.person_verifications (
      id,
      client_id,
      person_id
    )
    ON DELETE SET NULL (verification_id)
);

ALTER TABLE public.person_enrichment_observations
  ADD CONSTRAINT person_enrichment_observation_scope_key
  UNIQUE (id, client_id, person_id);

CREATE INDEX idx_person_enrichment_observations_person
  ON public.person_enrichment_observations (
    client_id,
    person_id,
    created_at DESC
  );

CREATE INDEX idx_person_enrichment_observations_key
  ON public.person_enrichment_observations (
    client_id,
    person_id,
    attribute_key,
    created_at DESC
  );


CREATE TABLE public.person_enrichment_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  client_id uuid NOT NULL
    REFERENCES public.clients(id)
    ON DELETE CASCADE,

  person_id uuid NOT NULL
    REFERENCES public.persons(id)
    ON DELETE CASCADE,

  attribute_key text NOT NULL,

  attribute_label text,

  value jsonb NOT NULL,

  value_type text NOT NULL
    DEFAULT 'text',

  normalized_value text,

  source_name text NOT NULL,

  confidence smallint,

  verified_at timestamptz,

  verification_id uuid,

  current_observation_id uuid,

  metadata jsonb NOT NULL
    DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL
    DEFAULT NOW(),

  updated_at timestamptz NOT NULL
    DEFAULT NOW(),

  CONSTRAINT person_enrichment_key_check
    CHECK (
      attribute_key ~ '^[a-z][a-z0-9_]{0,99}$'
    ),

  CONSTRAINT person_enrichment_type_check
    CHECK (
      value_type IN (
        'text',
        'number',
        'boolean',
        'date',
        'url',
        'list',
        'object'
      )
    ),

  CONSTRAINT person_enrichment_confidence_check
    CHECK (
      confidence IS NULL
      OR (
        confidence >= 0
        AND confidence <= 100
      )
    ),

  CONSTRAINT person_enrichment_label_check
    CHECK (
      attribute_label IS NULL
      OR length(attribute_label) <= 200
    ),

  CONSTRAINT person_enrichment_metadata_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
    ),

  CONSTRAINT person_enrichment_current_observation_fkey
    FOREIGN KEY (
      current_observation_id,
      client_id,
      person_id
    )
    REFERENCES public.person_enrichment_observations (
      id,
      client_id,
      person_id
    ),

  CONSTRAINT person_enrichment_verification_fkey
    FOREIGN KEY (
      verification_id,
      client_id,
      person_id
    )
    REFERENCES public.person_verifications (
      id,
      client_id,
      person_id
    )
    ON DELETE SET NULL (verification_id)
);

CREATE UNIQUE INDEX uq_person_enrichment_attribute
  ON public.person_enrichment_attributes (
    client_id,
    person_id,
    attribute_key
  );

CREATE INDEX idx_person_enrichment_person
  ON public.person_enrichment_attributes (
    client_id,
    person_id,
    updated_at DESC
  );

CREATE INDEX idx_person_enrichment_key
  ON public.person_enrichment_attributes (
    client_id,
    attribute_key
  );


GRANT SELECT, INSERT, UPDATE, DELETE
ON public.person_verifications,
   public.person_enrichment_observations,
   public.person_enrichment_attributes
TO "lumina-bridge@lumina-staging-509411.iam";


INSERT INTO public.schema_migrations (
  version,
  description
)
VALUES (
  '015',
  'Living Database verification history and client-scoped enrichment foundation'
)
ON CONFLICT (version)
DO NOTHING;

COMMIT;
