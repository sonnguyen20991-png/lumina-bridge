function cleanText(value, maxLength = 500) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function boundedConfidence(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('INVALID_CONFIDENCE');
  }

  return parsed;
}

function requireObject(value, code) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error(code);
  }

  return value;
}

function requireArray(value, code) {
  if (!Array.isArray(value)) {
    throw new Error(code);
  }

  return value;
}

const VERIFICATION_TYPES = new Set([
  'scheduled',
  'campaign',
  'manual',
  'on_demand',
  'import_followup'
]);

const TERMINAL_STATUSES = new Set([
  'completed',
  'partial'
]);

const FRESHNESS_RESULTS = new Set([
  'healthy',
  'aging',
  'changed',
  'needs_review',
  'incomplete',
  'restricted',
  'unverified'
]);

const VALUE_TYPES = new Set([
  'text',
  'number',
  'boolean',
  'date',
  'url',
  'list',
  'object'
]);

const OBSERVATION_DECISIONS = new Set([
  'observed',
  'accepted',
  'kept_existing',
  'needs_review'
]);

export async function queuePersonVerification(
  client,
  {
    clientId,
    personId,
    requestedBy = 'lumina-bridge',
    verificationType = 'scheduled',
    scheduledFor = null,
    metadata = {}
  }
) {
  if (!clientId || !personId) {
    throw new Error('VERIFICATION_SCOPE_REQUIRED');
  }

  if (!VERIFICATION_TYPES.has(verificationType)) {
    throw new Error('INVALID_VERIFICATION_TYPE');
  }

  requireObject(metadata, 'INVALID_VERIFICATION_METADATA');

  const person = await client.query(
    `
      SELECT id
      FROM persons
      WHERE id = $1
        AND status = 'active'
      LIMIT 1
    `,
    [personId]
  );

  if (person.rowCount !== 1) {
    throw new Error('PERSON_NOT_FOUND');
  }

  const result = await client.query(
    `
      INSERT INTO person_verifications (
        client_id,
        person_id,
        requested_by,
        verification_type,
        status,
        scheduled_for,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'queued',
        $5,
        $6::jsonb
      )
      ON CONFLICT (
        client_id,
        person_id
      )
      WHERE status IN ('queued', 'running')
      DO UPDATE SET
        scheduled_for =
          CASE
            WHEN person_verifications.status = 'running'
              THEN person_verifications.scheduled_for
            WHEN person_verifications.scheduled_for IS NULL
              THEN EXCLUDED.scheduled_for
            WHEN EXCLUDED.scheduled_for IS NULL
              THEN person_verifications.scheduled_for
            ELSE LEAST(
              person_verifications.scheduled_for,
              EXCLUDED.scheduled_for
            )
          END,
        metadata =
          person_verifications.metadata ||
          EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `,
    [
      clientId,
      personId,
      cleanText(requestedBy, 300) || 'lumina-bridge',
      verificationType,
      scheduledFor,
      JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

export async function claimNextPersonVerification(
  client,
  {
    clientId = null
  } = {}
) {
  const params = [];
  let clientClause = '';

  if (clientId) {
    params.push(clientId);
    clientClause = `AND client_id = $${params.length}`;
  }

  const result = await client.query(
    `
      WITH candidate AS (
        SELECT id
        FROM person_verifications
        WHERE status = 'queued'
          AND (
            scheduled_for IS NULL
            OR scheduled_for <= NOW()
          )
          ${clientClause}
        ORDER BY
          scheduled_for ASC NULLS FIRST,
          created_at ASC,
          id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE person_verifications v
      SET
        status = 'running',
        started_at = COALESCE(
          v.started_at,
          NOW()
        ),
        updated_at = NOW()
      FROM candidate
      WHERE v.id = candidate.id
      RETURNING v.*
    `,
    params
  );

  return result.rowCount > 0
    ? result.rows[0]
    : null;
}

export async function completePersonVerification(
  client,
  {
    verificationId,
    clientId,
    personId,
    status = 'completed',
    freshnessResult,
    confidence = null,
    sourcesChecked = [],
    summary = {},
    metadata = {}
  }
) {
  if (!TERMINAL_STATUSES.has(status)) {
    throw new Error('INVALID_COMPLETION_STATUS');
  }

  if (!FRESHNESS_RESULTS.has(freshnessResult)) {
    throw new Error('INVALID_FRESHNESS_RESULT');
  }

  const checked = requireArray(
    sourcesChecked,
    'INVALID_SOURCES_CHECKED'
  );

  requireObject(summary, 'INVALID_VERIFICATION_SUMMARY');
  requireObject(metadata, 'INVALID_VERIFICATION_METADATA');

  const result = await client.query(
    `
      UPDATE person_verifications
      SET
        status = $4,
        freshness_result = $5,
        confidence = $6,
        sources_checked = $7::jsonb,
        summary = $8::jsonb,
        metadata = metadata || $9::jsonb,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND client_id = $2
        AND person_id = $3
        AND status = 'running'
      RETURNING *
    `,
    [
      verificationId,
      clientId,
      personId,
      status,
      freshnessResult,
      boundedConfidence(confidence),
      JSON.stringify(checked),
      JSON.stringify(summary),
      JSON.stringify(metadata)
    ]
  );

  if (result.rowCount !== 1) {
    throw new Error('VERIFICATION_NOT_RUNNING');
  }

  return result.rows[0];
}

export async function failPersonVerification(
  client,
  {
    verificationId,
    clientId,
    personId,
    summary = {},
    metadata = {}
  }
) {
  requireObject(summary, 'INVALID_VERIFICATION_SUMMARY');
  requireObject(metadata, 'INVALID_VERIFICATION_METADATA');

  const result = await client.query(
    `
      UPDATE person_verifications
      SET
        status = 'failed',
        freshness_result = 'unverified',
        summary = $4::jsonb,
        metadata = metadata || $5::jsonb,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND client_id = $2
        AND person_id = $3
        AND status = 'running'
      RETURNING *
    `,
    [
      verificationId,
      clientId,
      personId,
      JSON.stringify(summary),
      JSON.stringify(metadata)
    ]
  );

  if (result.rowCount !== 1) {
    throw new Error('VERIFICATION_NOT_RUNNING');
  }

  return result.rows[0];
}

export async function recordPersonEnrichmentObservation(
  pool,
  {
    clientId,
    personId,
    attributeKey,
    attributeLabel = null,
    value,
    valueType = 'text',
    normalizedValue = null,
    sourceName,
    confidence = null,
    observedAt = null,
    verificationId = null,
    decision = 'observed',
    metadata = {}
  }
) {
  const key = cleanText(attributeKey, 100);
  const source = cleanText(sourceName, 300);

  if (
    !key ||
    !/^[a-z][a-z0-9_]{0,99}$/.test(key)
  ) {
    throw new Error('INVALID_ATTRIBUTE_KEY');
  }

  if (!VALUE_TYPES.has(valueType)) {
    throw new Error('INVALID_VALUE_TYPE');
  }

  if (!OBSERVATION_DECISIONS.has(decision)) {
    throw new Error('INVALID_OBSERVATION_DECISION');
  }

  if (!source) {
    throw new Error('SOURCE_NAME_REQUIRED');
  }

  if (value === undefined) {
    throw new Error('ATTRIBUTE_VALUE_REQUIRED');
  }

  requireObject(metadata, 'INVALID_ENRICHMENT_METADATA');

  const parsedConfidence =
    boundedConfidence(confidence);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const person = await client.query(
      `
        SELECT id
        FROM persons
        WHERE id = $1
          AND status = 'active'
        FOR SHARE
      `,
      [personId]
    );

    if (person.rowCount !== 1) {
      throw new Error('PERSON_NOT_FOUND');
    }

    if (verificationId) {
      const verification = await client.query(
        `
          SELECT id
          FROM person_verifications
          WHERE id = $1
            AND client_id = $2
            AND person_id = $3
          FOR SHARE
        `,
        [
          verificationId,
          clientId,
          personId
        ]
      );

      if (verification.rowCount !== 1) {
        throw new Error('VERIFICATION_SCOPE_MISMATCH');
      }
    }

    const observation = await client.query(
      `
        INSERT INTO person_enrichment_observations (
          client_id,
          person_id,
          attribute_key,
          attribute_label,
          observed_value,
          value_type,
          normalized_value,
          source_name,
          confidence,
          observed_at,
          verification_id,
          decision,
          metadata
        )
        VALUES (
          $1,$2,$3,$4,$5::jsonb,$6,$7,
          $8,$9,COALESCE($10,NOW()),$11,$12,$13::jsonb
        )
        RETURNING *
      `,
      [
        clientId,
        personId,
        key,
        cleanText(attributeLabel, 200),
        JSON.stringify(value),
        valueType,
        cleanText(normalizedValue, 2000),
        source,
        parsedConfidence,
        observedAt,
        verificationId,
        decision,
        JSON.stringify(metadata)
      ]
    );

    let current = null;

    if (decision === 'accepted') {
      const promoted = await client.query(
        `
          INSERT INTO person_enrichment_attributes (
            client_id,
            person_id,
            attribute_key,
            attribute_label,
            value,
            value_type,
            normalized_value,
            source_name,
            confidence,
            verified_at,
            verification_id,
            current_observation_id,
            metadata
          )
          VALUES (
            $1,$2,$3,$4,$5::jsonb,$6,$7,
            $8,$9,COALESCE($10,NOW()),$11,$12,$13::jsonb
          )
          ON CONFLICT (
            client_id,
            person_id,
            attribute_key
          )
          DO UPDATE SET
            attribute_label =
              COALESCE(
                EXCLUDED.attribute_label,
                person_enrichment_attributes.attribute_label
              ),
            value = EXCLUDED.value,
            value_type = EXCLUDED.value_type,
            normalized_value = EXCLUDED.normalized_value,
            source_name = EXCLUDED.source_name,
            confidence = EXCLUDED.confidence,
            verified_at = EXCLUDED.verified_at,
            verification_id = EXCLUDED.verification_id,
            current_observation_id =
              EXCLUDED.current_observation_id,
            metadata =
              person_enrichment_attributes.metadata ||
              EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING *
        `,
        [
          clientId,
          personId,
          key,
          cleanText(attributeLabel, 200),
          JSON.stringify(value),
          valueType,
          cleanText(normalizedValue, 2000),
          source,
          parsedConfidence,
          observedAt,
          verificationId,
          observation.rows[0].id,
          JSON.stringify(metadata)
        ]
      );

      current = promoted.rows[0];
    }

    await client.query('COMMIT');

    return {
      observation: observation.rows[0],
      current
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

export async function getPersonFreshness(
  client,
  {
    clientId,
    personId
  }
) {
  const latest = await client.query(
    `
      SELECT *
      FROM person_verifications
      WHERE client_id = $1
        AND person_id = $2
        AND status IN (
          'completed',
          'partial',
          'failed'
        )
      ORDER BY
        COALESCE(
          completed_at,
          created_at
        ) DESC,
        id DESC
      LIMIT 1
    `,
    [
      clientId,
      personId
    ]
  );

  const open = await client.query(
    `
      SELECT *
      FROM person_verifications
      WHERE client_id = $1
        AND person_id = $2
        AND status IN (
          'queued',
          'running'
        )
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [
      clientId,
      personId
    ]
  );

  return {
    latest:
      latest.rowCount > 0
        ? latest.rows[0]
        : null,
    open:
      open.rowCount > 0
        ? open.rows[0]
        : null
  };
}

export async function getPersonEnrichment(
  client,
  {
    clientId,
    personId
  }
) {
  const result = await client.query(
    `
      SELECT
        id,
        person_id,
        attribute_key,
        attribute_label,
        value,
        value_type,
        normalized_value,
        source_name,
        confidence,
        verified_at,
        verification_id,
        current_observation_id,
        metadata,
        created_at,
        updated_at
      FROM person_enrichment_attributes
      WHERE client_id = $1
        AND person_id = $2
      ORDER BY
        attribute_key ASC
    `,
    [
      clientId,
      personId
    ]
  );

  return result.rows;
}
