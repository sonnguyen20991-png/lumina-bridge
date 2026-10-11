function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return true;
}

function boundedScore(value) {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 100
  ) {
    return null;
  }

  return parsed;
}

export function buildPersonDataQuality({
  person = {},
  contact = {},
  company = null,
  freshness = {},
  enrichment = [],
  duplicateCandidates = []
} = {}) {
  const fields = [
    ['full_name', person?.full_name],
    ['current_title', person?.current_title],
    ['department', person?.department],
    ['seniority', person?.seniority],
    ['contact_city', person?.contact_city],
    ['contact_country', person?.contact_country],
    ['linkedin_url', person?.linkedin_url],
    ['primary_email', contact?.primary_email],
    ['primary_phone', contact?.primary_phone],
    ['company_name', company?.name],
    ['company_domain', company?.domain]
  ];

  const present = fields
    .filter(([, value]) => hasValue(value))
    .map(([field]) => field);

  const missing = fields
    .filter(([, value]) => !hasValue(value))
    .map(([field]) => field);

  const latest = freshness?.latest ?? null;
  const verificationPending =
    Boolean(freshness?.open);

  const safeEnrichment =
    Array.isArray(enrichment)
      ? enrichment
      : [];

  const safeDuplicateCandidates =
    Array.isArray(duplicateCandidates)
      ? duplicateCandidates
      : [];

  const validDuplicateScores =
    safeDuplicateCandidates
      .map((candidate) =>
        boundedScore(candidate?.match_score)
      )
      .filter((score) => score !== null);

  const pendingCount =
    safeDuplicateCandidates.filter(
      (candidate) =>
        candidate?.status === 'pending'
    ).length;

  const signals = [];

  if (!latest) {
    signals.push('verification_missing');
  }

  if (verificationPending) {
    signals.push('verification_pending');
  }

  if (pendingCount > 0) {
    signals.push('duplicate_review_required');
  }

  if (missing.length > 0) {
    signals.push('incomplete_record');
  }

  return {
    completeness: {
      present,
      missing,
      present_count: present.length,
      total_count: fields.length
    },

    freshness: {
      status:
        latest?.freshness_result ||
        'unverified',

      confidence:
        boundedScore(latest?.confidence),

      last_verified_at:
        latest?.completed_at || null,

      verification_pending:
        verificationPending
    },

    evidence: {
      enrichment_count:
        safeEnrichment.length,

      verified_enrichment_count:
        safeEnrichment.filter(
          (item) =>
            hasValue(item?.verified_at)
        ).length
    },

    duplicates: {
      candidate_count:
        safeDuplicateCandidates.length,

      pending_count:
        pendingCount,

      highest_match_score:
        validDuplicateScores.length
          ? Math.max(...validDuplicateScores)
          : null,

      needs_review:
        pendingCount > 0
    },

    signals
  };
}
