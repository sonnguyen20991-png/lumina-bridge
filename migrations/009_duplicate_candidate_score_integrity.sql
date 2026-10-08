BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
              'duplicate_candidates_match_score_check'
          AND conrelid =
              'public.duplicate_candidates'::regclass
    ) THEN
        ALTER TABLE public.duplicate_candidates
        ADD CONSTRAINT duplicate_candidates_match_score_check
        CHECK (
            match_score >= 0
            AND match_score <= 100
        );
    END IF;
END
$$;

INSERT INTO schema_migrations (
    version,
    description
)
VALUES (
    '009',
    'Duplicate candidate score integrity for review-only fuzzy person matching'
)
ON CONFLICT (version)
DO NOTHING;

COMMIT;
