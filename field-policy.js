function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  return cleaned || null;
}

function comparable(value, entityType, fieldName) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const base = cleaned.toLocaleLowerCase();

  if (entityType === 'company' && fieldName === 'country') {
    const country = base.replace(/\s+/g, ' ');
    if (country === 'united kingdom' ||
        country === 'united kingdom uk') {
      return 'united kingdom';
    }
  }


  if (entityType === 'company' && fieldName === 'industry') {
    const industry = base.replace(/\s+/g, ' ');
    if (/^computer\s*(?:&|and)\s*network security$/.test(industry)) {
      return 'computer and network security';
    }
    return industry;
  }

  if (entityType === 'company' && fieldName === 'staff_count_range') {
    const range = base.match(/^(\d+)\s*[-–—]\s*(\d+)\s+employees?$/);
    if (range) return `${range[1]}-${range[2]} employees`;
  }

  return base;
}

/**
 * Pure Revision 12 field decision engine.
 *
 * This function does NOT write to PostgreSQL.
 * It only determines what Lumina should do.
 */
export function decideFieldUpdate({
  entityType = null,
  fieldName = null,
  existingValue,
  incomingValue,

  existingPriority = 50,
  incomingPriority = 50,

  existingProtected = false,
  incomingCanOverwrite = true
}) {
  const existing =
    cleanText(existingValue);

  const incoming =
    cleanText(incomingValue);

  // ----------------------------------------------------------
  // No usable incoming value
  // ----------------------------------------------------------

  if (!incoming) {
    return {
      decision: 'rejected',
      applyIncoming: false,
      reason: 'incoming_value_empty'
    };
  }

  // ----------------------------------------------------------
  // Canonical field is currently empty
  // ----------------------------------------------------------

  if (!existing) {
    return {
      decision: 'accepted',
      applyIncoming: true,
      reason: 'canonical_value_empty'
    };
  }

  // ----------------------------------------------------------
  // Same semantic value
  // ----------------------------------------------------------

  if (
    comparable(existing, entityType, fieldName) ===
    comparable(incoming, entityType, fieldName)
  ) {
    return {
      decision: 'same_value',
      applyIncoming: false,
      reason: 'same_value'
    };
  }

  // ----------------------------------------------------------
  // Human/manual protected canonical value
  // ----------------------------------------------------------

  if (existingProtected) {
    return {
      decision: 'protected',
      applyIncoming: false,
      reason: 'canonical_value_protected'
    };
  }

  // ----------------------------------------------------------
  // Incoming source is not allowed to overwrite
  // ----------------------------------------------------------

  if (!incomingCanOverwrite) {
    return {
      decision: 'kept_existing',
      applyIncoming: false,
      reason: 'incoming_source_cannot_overwrite'
    };
  }

  // ----------------------------------------------------------
  // Higher-quality incoming source
  // ----------------------------------------------------------

  if (incomingPriority > existingPriority) {
    return {
      decision: 'accepted',
      applyIncoming: true,
      reason: 'higher_priority_source'
    };
  }

  // ----------------------------------------------------------
  // Lower-quality incoming source
  // ----------------------------------------------------------

  if (incomingPriority < existingPriority) {
    return {
      decision: 'kept_existing',
      applyIncoming: false,
      reason: 'lower_priority_source'
    };
  }

  // ----------------------------------------------------------
  // Equal-quality disagreement
  //
  // Do not guess. Send to manual review.
  // ----------------------------------------------------------

  return {
    decision: 'conflict',
    applyIncoming: false,
    reason: 'equal_priority_disagreement'
  };
}
