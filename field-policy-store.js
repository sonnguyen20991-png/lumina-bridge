import {
  decideFieldUpdate
} from './field-policy.js';

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  return cleaned || null;
}

function normalizeText(value) {
  const cleaned = cleanText(value);

  return cleaned
    ? cleaned.toLocaleLowerCase()
    : null;
}

function jsonValue(value) {
  return JSON.stringify(value);
}

function ownerColumn(entityType) {
  if (entityType === 'person') {
    return 'person_id';
  }

  if (entityType === 'company') {
    return 'company_id';
  }

  throw new Error(
    `Unsupported entity type: ${entityType}`
  );
}

export async function getSourcePolicy(
  client,
  sourceName
) {
  const result = await client.query(
    `
      SELECT
        source_name,
        priority,
        source_kind,
        can_overwrite,
        protect_when_accepted
      FROM source_quality_policies
      WHERE source_name = $1
        AND status = 'active'
      LIMIT 1
    `,
    [sourceName]
  );

  if (result.rowCount > 0) {
    return result.rows[0];
  }

  return {
    source_name: sourceName,
    priority: 50,
    source_kind: 'unknown',
    can_overwrite: true,
    protect_when_accepted: false
  };
}

async function insertObservation(
  client,
  {
    entityType,
    entityId,
    fieldName,
    value,
    sourceName,
    sourceRecordId,
    sourcePriority,
    decision,
    importJobId,
    rawRowId,
    metadata = {}
  }
) {
  const column =
    ownerColumn(entityType);

  const result = await client.query(
    `
      INSERT INTO field_observations (
        ${column},
        field_name,
        observed_value,
        normalized_value,
        source_name,
        source_record_id,
        source_priority,
        decision,
        import_job_id,
        raw_source_row_id,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb
      )
      RETURNING id
    `,
    [
      entityId,
      fieldName,
      jsonValue(value),
      normalizeText(value),
      sourceName,
      sourceRecordId,
      sourcePriority,
      decision,
      importJobId,
      rawRowId,
      JSON.stringify(metadata)
    ]
  );

  return result.rows[0].id;
}

async function createFieldState(
  client,
  {
    entityType,
    entityId,
    fieldName,
    value,
    sourceName,
    sourcePriority,
    isProtected,
    observationId,
    metadata = {}
  }
) {
  const column =
    ownerColumn(entityType);

  const result = await client.query(
    `
      INSERT INTO canonical_field_state (
        ${column},
        field_name,
        current_value,
        normalized_value,
        source_name,
        source_priority,
        is_protected,
        current_observation_id,
        metadata
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb
      )
      RETURNING
        id,
        current_value,
        normalized_value,
        source_name,
        source_priority,
        is_protected,
        current_observation_id
    `,
    [
      entityId,
      fieldName,
      jsonValue(value),
      normalizeText(value),
      sourceName,
      sourcePriority,
      isProtected,
      observationId,
      JSON.stringify(metadata)
    ]
  );

  return result.rows[0];
}

async function getFieldState(
  client,
  {
    entityType,
    entityId,
    fieldName
  }
) {
  const column =
    ownerColumn(entityType);

  const result = await client.query(
    `
      SELECT
        id,
        current_value,
        normalized_value,
        source_name,
        source_priority,
        is_protected,
        current_observation_id
      FROM canonical_field_state
      WHERE ${column} = $1
        AND field_name = $2
      LIMIT 1
    `,
    [
      entityId,
      fieldName
    ]
  );

  return result.rowCount > 0
    ? result.rows[0]
    : null;
}

async function bootstrapLegacyState(
  client,
  {
    entityType,
    entityId,
    fieldName,
    existingValue
  }
) {
  const existing =
    cleanText(existingValue);

  if (!existing) {
    return null;
  }

  const observationId =
    await insertObservation(
      client,
      {
        entityType,
        entityId,
        fieldName,
        value: existing,
        sourceName: 'legacy_canonical',
        sourceRecordId: null,
        sourcePriority: 50,
        decision: 'accepted',
        importJobId: null,
        rawRowId: null,
        metadata: {
          bootstrapped: true,
          reason:
            'canonical_value_predates_field_provenance'
        }
      }
    );

  return createFieldState(
    client,
    {
      entityType,
      entityId,
      fieldName,
      value: existing,
      sourceName: 'legacy_canonical',
      sourcePriority: 50,
      isProtected: false,
      observationId,
      metadata: {
        bootstrapped: true
      }
    }
  );
}

async function updateAcceptedState(
  client,
  {
    stateId,
    value,
    sourceName,
    sourcePriority,
    isProtected,
    observationId
  }
) {
  await client.query(
    `
      UPDATE canonical_field_state
      SET
        current_value = $2::jsonb,
        normalized_value = $3,
        source_name = $4,
        source_priority = $5,
        is_protected = $6,
        current_observation_id = $7,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      stateId,
      jsonValue(value),
      normalizeText(value),
      sourceName,
      sourcePriority,
      isProtected,
      observationId
    ]
  );
}

async function createFieldConflict(
  client,
  {
    entityType,
    entityId,
    fieldName,
    existingValue,
    incomingValue,
    sourceName,
    sourceRecordId,
    importJobId,
    rawRowId,
    existingPriority,
    incomingPriority
  }
) {
  const result = await client.query(
    `
      INSERT INTO conflicts (
        entity_type,
        entity_id,
        field_name,
        existing_value,
        incoming_value,
        source_name,
        source_record_id,
        status,
        import_job_id,
        raw_source_row_id,
        conflict_type,
        evidence
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'open',
        $8,
        $9,
        'field_value_disagreement',
        $10::jsonb
      )
      RETURNING id
    `,
    [
      entityType,
      entityId,
      fieldName,
      cleanText(existingValue),
      cleanText(incomingValue),
      sourceName,
      sourceRecordId,
      importJobId,
      rawRowId,
      JSON.stringify({
        existing_priority:
          existingPriority,
        incoming_priority:
          incomingPriority
      })
    ]
  );

  const conflictId =
    result.rows[0].id;

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
        'canonical_field.conflict_created',
        $1,
        $2,
        $3::jsonb
      )
    `,
    [
      entityType,
      entityId,
      JSON.stringify({
        conflict_id: conflictId,
        field_name: fieldName,
        existing_value:
          cleanText(existingValue),
        incoming_value:
          cleanText(incomingValue),
        source_name: sourceName,
        source_record_id:
          sourceRecordId,
        import_job_id:
          importJobId,
        raw_source_row_id:
          rawRowId,
        existing_priority:
          existingPriority,
        incoming_priority:
          incomingPriority,
        conflict_type:
          'field_value_disagreement'
      })
    ]
  );

  return conflictId;
}

export async function evaluateFieldUpdate(
  client,
  {
    entityType,
    entityId,
    fieldName,
    existingValue,
    incomingValue,
    sourceName,
    sourceRecordId = null,
    importJobId = null,
    rawRowId = null
  }
) {
  ownerColumn(entityType);

  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtext($1)
      )
    `,
    [
      `field-policy:${entityType}:${entityId}:${fieldName}`
    ]
  );

  const incomingPolicy =
    await getSourcePolicy(
      client,
      sourceName
    );

  let state =
    await getFieldState(
      client,
      {
        entityType,
        entityId,
        fieldName
      }
    );

  if (!state) {
    state =
      await bootstrapLegacyState(
        client,
        {
          entityType,
          entityId,
          fieldName,
          existingValue
        }
      );
  }

  const canonicalValue =
    state
      ? state.current_value
      : existingValue;

  const existingPriority =
    state
      ? state.source_priority
      : 50;

  // Reporting is different from the internal comparison fallback.
  //
  // If there is genuinely no prior canonical/provenance owner,
  // expose null instead of implying that priority 50 existed.
  const reportedExistingPriority =
    state
      ? state.source_priority
      : null;

  const existingProtected =
    state
      ? state.is_protected
      : false;

  const decision =
    decideFieldUpdate({
      entityType,
      fieldName,
      existingValue:
        canonicalValue,
      incomingValue,
      existingPriority,
      incomingPriority:
        incomingPolicy.priority,
      existingProtected,
      incomingCanOverwrite:
        incomingPolicy.can_overwrite
    });

  const observationId =
    await insertObservation(
      client,
      {
        entityType,
        entityId,
        fieldName,
        value: incomingValue,
        sourceName,
        sourceRecordId,
        sourcePriority:
          incomingPolicy.priority,
        decision:
          decision.decision,
        importJobId,
        rawRowId,
        metadata: {
          reason:
            decision.reason
        }
      }
    );

  let conflictId = null;

  if (decision.decision === 'accepted') {
    const protectIncoming =
      incomingPolicy
        .protect_when_accepted;

    if (state) {
      await updateAcceptedState(
        client,
        {
          stateId: state.id,
          value: incomingValue,
          sourceName,
          sourcePriority:
            incomingPolicy.priority,
          isProtected:
            protectIncoming,
          observationId
        }
      );
    } else {
      state =
        await createFieldState(
          client,
          {
            entityType,
            entityId,
            fieldName,
            value: incomingValue,
            sourceName,
            sourcePriority:
              incomingPolicy.priority,
            isProtected:
              protectIncoming,
            observationId,
            metadata: {
              created_by:
                'field_policy'
            }
          }
        );
    }
  }

  let provenancePromoted = false;

  // ----------------------------------------------------------
  // Same-value provenance promotion
  //
  // The physical canonical value does not need to change, but
  // a stronger confirming source should be allowed to become
  // the provenance owner.
  //
  // Protected ownership is never downgraded by an ordinary
  // automated source.
  // ----------------------------------------------------------

  if (
    decision.decision === 'same_value' &&
    state &&
    !existingProtected
  ) {
    const higherPriority =
      incomingPolicy.priority >
      existingPriority;

    const addsProtection =
      incomingPolicy.protect_when_accepted &&
      incomingPolicy.priority >=
        existingPriority;

    if (
      higherPriority ||
      addsProtection
    ) {
      const resultingProtected =
        existingProtected ||
        incomingPolicy
          .protect_when_accepted;

      await updateAcceptedState(
        client,
        {
          stateId: state.id,

          // Preserve the existing canonical representation.
          // This is provenance promotion, not value mutation.
          value: canonicalValue,

          sourceName,
          sourcePriority:
            incomingPolicy.priority,

          isProtected:
            resultingProtected,

          observationId
        }
      );

      provenancePromoted = true;
    }
  }

  if (decision.decision === 'conflict') {
    conflictId =
      await createFieldConflict(
        client,
        {
          entityType,
          entityId,
          fieldName,
          existingValue:
            canonicalValue,
          incomingValue,
          sourceName,
          sourceRecordId,
          importJobId,
          rawRowId,
          existingPriority,
          incomingPriority:
            incomingPolicy.priority
        }
      );
  }

  return {
    ...decision,
    observationId,
    conflictId,
    incomingPriority:
      incomingPolicy.priority,
    incomingSourceKind:
      incomingPolicy.source_kind,
    existingPriority:
      reportedExistingPriority,
    existingProtected,
    provenancePromoted
  };
}
