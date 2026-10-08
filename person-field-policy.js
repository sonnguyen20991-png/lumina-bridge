import {
  evaluateFieldUpdate
} from './field-policy-store.js';

const CONTROLLED_FIELDS = [
  'current_title',
  'department',
  'seniority'
];

export async function evaluatePersonFieldPolicies(
  client,
  {
    personId,
    existingValues = {},
    incomingValues = {},
    sourceName,
    sourceRecordId = null,
    importJobId = null,
    rawRowId = null
  }
) {
  const decisions = {};
  const updates = {};
  const summary = {};

  let hasConflict = false;

  for (const fieldName of CONTROLLED_FIELDS) {
    const incomingValue =
      incomingValues[fieldName] ?? null;

    // Missing fields are ignored exactly like the old
    // COALESCE-based importer behavior.
    if (incomingValue === null) {
      continue;
    }

    const result =
      await evaluateFieldUpdate(
        client,
        {
          entityType: 'person',
          entityId: personId,
          fieldName,
          existingValue:
            existingValues[fieldName] ?? null,
          incomingValue,
          sourceName,
          sourceRecordId,
          importJobId,
          rawRowId
        }
      );

    decisions[fieldName] = result;

    if (result.applyIncoming) {
      updates[fieldName] =
        incomingValue;
    }

    if (result.decision === 'conflict') {
      hasConflict = true;
    }

    summary[fieldName] = {
      decision:
        result.decision,
      reason:
        result.reason,
      apply_incoming:
        result.applyIncoming,
      existing_priority:
        result.existingPriority ?? null,
      incoming_priority:
        result.incomingPriority ?? null,
      observation_id:
        result.observationId ?? null,
      conflict_id:
        result.conflictId ?? null,
      provenance_promoted:
        result.provenancePromoted ?? false
    };
  }

  return {
    decisions,
    updates,
    summary,
    hasConflict
  };
}
