const NAME_SIMILARITY_FLOOR = 0.70;
const CANDIDATE_SCORE_THRESHOLD = 72;
const SEARCH_LIMIT = 25;
const STORE_LIMIT = 5;

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  return cleaned || null;
}

function normalizedText(value) {
  const cleaned = cleanText(value);

  return cleaned
    ? cleaned.toLocaleLowerCase()
    : null;
}

function sameText(left, right) {
  const a = normalizedText(left);
  const b = normalizedText(right);

  return Boolean(
    a &&
    b &&
    a === b
  );
}

function roundScore(value) {
  return Math.round(
    Number(value) * 100
  ) / 100;
}

export function scoreDuplicateEvidence({
  nameSimilarity = 0,
  titleSimilarity = 0,
  sameCurrentCompany = false,
  sameCountry = false,
  sameCity = false,
  sameDepartment = false,
  sameSeniority = false
}) {
  const safeNameSimilarity =
    Math.max(
      0,
      Math.min(1, Number(nameSimilarity) || 0)
    );

  const safeTitleSimilarity =
    Math.max(
      0,
      Math.min(1, Number(titleSimilarity) || 0)
    );

  const points = {
    name:
      roundScore(
        safeNameSimilarity * 60
      ),

    current_company:
      sameCurrentCompany ? 20 : 0,

    title:
      roundScore(
        safeTitleSimilarity * 10
      ),

    country:
      sameCountry ? 4 : 0,

    city:
      sameCity ? 3 : 0,

    department:
      sameDepartment ? 2 : 0,

    seniority:
      sameSeniority ? 1 : 0
  };

  const score =
    roundScore(
      Object.values(points)
        .reduce(
          (sum, value) => sum + value,
          0
        )
    );

  return {
    score:
      Math.max(
        0,
        Math.min(100, score)
      ),
    points
  };
}

async function getPersonContext(
  client,
  personId
) {
  const result = await client.query(
    `
      SELECT
        p.id,
        p.full_name,
        p.current_title,
        p.department,
        p.seniority,
        p.contact_city,
        p.contact_country,
        p.normalized_linkedin_url,

        current_employment.company_id
          AS current_company_id

      FROM persons p

      LEFT JOIN LATERAL (
        SELECT e.company_id
        FROM employments e
        WHERE e.person_id = p.id
          AND e.is_current = true
        ORDER BY
          e.updated_at DESC,
          e.created_at DESC
        LIMIT 1
      ) current_employment
        ON true

      WHERE p.id = $1
      LIMIT 1
    `,
    [personId]
  );

  return result.rowCount === 1
    ? result.rows[0]
    : null;
}

async function findPlausibleCandidates(
  client,
  sourcePerson
) {
  if (!sourcePerson?.full_name) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        p.id,
        p.full_name,
        p.current_title,
        p.department,
        p.seniority,
        p.contact_city,
        p.contact_country,
        p.normalized_linkedin_url,

        current_employment.company_id
          AS current_company_id,

        similarity(
          p.full_name,
          $2
        )::double precision
          AS name_similarity,

        CASE
          WHEN p.current_title IS NOT NULL
           AND $5::text IS NOT NULL
          THEN similarity(
            p.current_title,
            $5
          )::double precision
          ELSE 0::double precision
        END AS title_similarity

      FROM persons p

      LEFT JOIN LATERAL (
        SELECT e.company_id
        FROM employments e
        WHERE e.person_id = p.id
          AND e.is_current = true
        ORDER BY
          e.updated_at DESC,
          e.created_at DESC
        LIMIT 1
      ) current_employment
        ON true

      WHERE p.id <> $1
        AND p.full_name IS NOT NULL

        -- Uses the existing pg_trgm GIN index.
        AND p.full_name % $2

        AND similarity(
              p.full_name,
              $2
            ) >= $3

        -- Two different strong LinkedIn identities must not be
        -- turned into a fuzzy duplicate suggestion.
        AND NOT (
          $4::text IS NOT NULL
          AND p.normalized_linkedin_url IS NOT NULL
          AND p.normalized_linkedin_url::text
                <> $4::text
        )

      ORDER BY
        similarity(
          p.full_name,
          $2
        ) DESC,
        p.id

      LIMIT $6
    `,
    [
      sourcePerson.id,
      sourcePerson.full_name,
      NAME_SIMILARITY_FLOOR,
      sourcePerson.normalized_linkedin_url
        ? String(
            sourcePerson.normalized_linkedin_url
          )
        : null,
      sourcePerson.current_title,
      SEARCH_LIMIT
    ]
  );

  return result.rows;
}

export async function findAndStoreDuplicateCandidates(
  client,
  {
    personId,
    importJobId = null,
    rawRowId = null
  }
) {
  const sourcePerson =
    await getPersonContext(
      client,
      personId
    );

  if (!sourcePerson) {
    throw new Error(
      `Canonical person not found: ${personId}`
    );
  }

  if (!sourcePerson.full_name) {
    return {
      evaluated: 0,
      qualified: 0,
      created: 0,
      candidates: []
    };
  }

  const plausibleCandidates =
    await findPlausibleCandidates(
      client,
      sourcePerson
    );

  const qualified = [];

  for (
    const candidate
    of plausibleCandidates
  ) {
    const sameCurrentCompany =
      Boolean(
        sourcePerson.current_company_id &&
        candidate.current_company_id &&
        sourcePerson.current_company_id ===
          candidate.current_company_id
      );

    const evidence = {
      nameSimilarity:
        Number(
          candidate.name_similarity
        ) || 0,

      titleSimilarity:
        Number(
          candidate.title_similarity
        ) || 0,

      sameCurrentCompany,

      sameCountry:
        sameText(
          sourcePerson.contact_country,
          candidate.contact_country
        ),

      sameCity:
        sameText(
          sourcePerson.contact_city,
          candidate.contact_city
        ),

      sameDepartment:
        sameText(
          sourcePerson.department,
          candidate.department
        ),

      sameSeniority:
        sameText(
          sourcePerson.seniority,
          candidate.seniority
        )
    };

    const scored =
      scoreDuplicateEvidence(
        evidence
      );

    if (
      scored.score <
      CANDIDATE_SCORE_THRESHOLD
    ) {
      continue;
    }

    qualified.push({
      candidate,
      evidence,
      score: scored.score,
      points: scored.points
    });
  }

  qualified.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.candidate.id)
        .localeCompare(
          String(b.candidate.id)
        )
  );

  const selected =
    qualified.slice(
      0,
      STORE_LIMIT
    );

  const stored = [];

  for (const item of selected) {
    const matchReasons = {
      scoring_version:
        'revision13_v1',

      threshold:
        CANDIDATE_SCORE_THRESHOLD,

      name_similarity_floor:
        NAME_SIMILARITY_FLOOR,

      score:
        item.score,

      points:
        item.points,

      evidence: {
        name_similarity:
          roundScore(
            item.evidence
              .nameSimilarity
          ),

        title_similarity:
          roundScore(
            item.evidence
              .titleSimilarity
          ),

        same_current_company:
          item.evidence
            .sameCurrentCompany,

        same_country:
          item.evidence
            .sameCountry,

        same_city:
          item.evidence
            .sameCity,

        same_department:
          item.evidence
            .sameDepartment,

        same_seniority:
          item.evidence
            .sameSeniority
      },

      source_person: {
        id:
          sourcePerson.id,
        full_name:
          sourcePerson.full_name,
        current_company_id:
          sourcePerson
            .current_company_id
      },

      candidate_person: {
        id:
          item.candidate.id,
        full_name:
          item.candidate.full_name,
        current_company_id:
          item.candidate
            .current_company_id
      }
    };

    const inserted =
      await client.query(
        `
          INSERT INTO duplicate_candidates (
            person_id_1,
            person_id_2,
            match_score,
            match_reasons,
            status,
            import_job_id,
            raw_source_row_id
          )
          VALUES (
            $1,
            $2,
            $3,
            $4::jsonb,
            'pending',
            $5,
            $6
          )
          ON CONFLICT DO NOTHING
          RETURNING id
        `,
        [
          personId,
          item.candidate.id,
          item.score,
          JSON.stringify(
            matchReasons
          ),
          importJobId,
          rawRowId
        ]
      );

    if (inserted.rowCount > 0) {
      const duplicateCandidateId =
        inserted.rows[0].id;

      await client.query(
        `
          INSERT INTO audit_events (
            actor,
            action,
            entity_type,
            entity_id,
            details
          )
          VALUES (
            'lumina-bridge',
            'duplicate_candidate.created',
            'duplicate_candidate',
            $1,
            $2::jsonb
          )
        `,
        [
          duplicateCandidateId,
          JSON.stringify({
            import_job_id: importJobId,
            raw_source_row_id: rawRowId,
            source_person_id: personId,
            candidate_person_id:
              item.candidate.id,
            match_score: item.score,
            status: 'pending',
            match_reasons: matchReasons
          })
        ]
      );
    }

    stored.push({
      candidate_person_id:
        item.candidate.id,
      score:
        item.score,
      duplicate_candidate_id:
        inserted.rowCount > 0
          ? inserted.rows[0].id
          : null,
      created:
        inserted.rowCount > 0,
      match_reasons:
        matchReasons
    });
  }

  return {
    evaluated:
      plausibleCandidates.length,
    qualified:
      qualified.length,
    created:
      stored.filter(
        item => item.created
      ).length,
    candidates:
      stored
  };
}

export const DUPLICATE_CANDIDATE_CONFIG = {
  nameSimilarityFloor:
    NAME_SIMILARITY_FLOOR,
  scoreThreshold:
    CANDIDATE_SCORE_THRESHOLD,
  searchLimit:
    SEARCH_LIMIT,
  storeLimit:
    STORE_LIMIT
};
