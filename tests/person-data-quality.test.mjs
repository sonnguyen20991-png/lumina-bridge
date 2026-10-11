import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPersonDataQuality
} from '../person-data-quality.js';

test('complete verified contact exposes explainable quality dimensions', () => {
  const result = buildPersonDataQuality({
    person: {
      full_name: 'Ada Lovelace',
      current_title: 'CTO',
      department: 'Engineering',
      seniority: 'C-Level',
      contact_city: 'Singapore',
      contact_country: 'Singapore',
      linkedin_url: 'https://www.linkedin.com/in/ada'
    },
    contact: {
      primary_email: 'ada@example.com',
      primary_phone: '+6512345678'
    },
    company: {
      name: 'Analytical Engines',
      domain: 'example.com'
    },
    freshness: {
      latest: {
        freshness_result: 'healthy',
        confidence: 94,
        completed_at: '2026-10-11T05:00:00.000Z'
      },
      open: null
    },
    enrichment: [
      {
        attribute_key: 'employee_count',
        verified_at: '2026-10-10T00:00:00.000Z'
      },
      {
        attribute_key: 'funding_stage',
        verified_at: null
      }
    ],
    duplicateCandidates: [
      {
        status: 'pending',
        match_score: 91
      },
      {
        status: 'pending',
        match_score: 78
      }
    ]
  });

  assert.equal(result.completeness.present_count, 11);
  assert.equal(result.completeness.total_count, 11);
  assert.deepEqual(result.completeness.missing, []);

  assert.deepEqual(result.freshness, {
    status: 'healthy',
    confidence: 94,
    last_verified_at: '2026-10-11T05:00:00.000Z',
    verification_pending: false
  });

  assert.deepEqual(result.evidence, {
    enrichment_count: 2,
    verified_enrichment_count: 1
  });

  assert.deepEqual(result.duplicates, {
    candidate_count: 2,
    pending_count: 2,
    highest_match_score: 91,
    needs_review: true
  });

  assert.ok(
    result.signals.includes('duplicate_review_required')
  );
});

test('sparse unverified contact reports missing data without fabricating a score', () => {
  const result = buildPersonDataQuality({
    person: {
      full_name: 'Sparse Contact',
      current_title: null,
      department: null,
      seniority: null,
      contact_city: null,
      contact_country: 'Vietnam',
      linkedin_url: null
    },
    contact: {
      primary_email: null,
      primary_phone: null
    },
    company: null,
    freshness: {
      latest: null,
      open: null
    },
    enrichment: [],
    duplicateCandidates: []
  });

  assert.equal(result.completeness.present_count, 2);
  assert.equal(result.completeness.total_count, 11);

  assert.ok(
    result.completeness.missing.includes('current_title')
  );
  assert.ok(
    result.completeness.missing.includes('primary_email')
  );
  assert.ok(
    result.completeness.missing.includes('company_domain')
  );

  assert.deepEqual(result.freshness, {
    status: 'unverified',
    confidence: null,
    last_verified_at: null,
    verification_pending: false
  });

  assert.deepEqual(result.evidence, {
    enrichment_count: 0,
    verified_enrichment_count: 0
  });

  assert.deepEqual(result.duplicates, {
    candidate_count: 0,
    pending_count: 0,
    highest_match_score: null,
    needs_review: false
  });

  assert.ok(
    result.signals.includes('verification_missing')
  );

  assert.equal(
    Object.hasOwn(result, 'score'),
    false
  );
});

test('open verification is surfaced independently from latest freshness', () => {
  const result = buildPersonDataQuality({
    person: {
      full_name: 'Verification Contact'
    },
    contact: {},
    company: null,
    freshness: {
      latest: {
        freshness_result: 'aging',
        confidence: 72,
        completed_at: '2026-09-01T00:00:00.000Z'
      },
      open: {
        status: 'queued'
      }
    },
    enrichment: [],
    duplicateCandidates: []
  });

  assert.equal(result.freshness.status, 'aging');
  assert.equal(result.freshness.confidence, 72);
  assert.equal(result.freshness.verification_pending, true);

  assert.ok(
    result.signals.includes('verification_pending')
  );
});

test('duplicate aggregation is bounded and ignores invalid scores safely', () => {
  const result = buildPersonDataQuality({
    person: {
      full_name: 'Duplicate Contact'
    },
    contact: {},
    company: null,
    freshness: {
      latest: null,
      open: null
    },
    enrichment: [],
    duplicateCandidates: [
      {
        status: 'pending',
        match_score: 88
      },
      {
        status: 'pending',
        match_score: 101
      },
      {
        status: 'closed',
        match_score: 79
      },
      {
        status: 'pending',
        match_score: 'invalid'
      }
    ]
  });

  assert.equal(result.duplicates.candidate_count, 4);
  assert.equal(result.duplicates.pending_count, 3);
  assert.equal(result.duplicates.highest_match_score, 88);
  assert.equal(result.duplicates.needs_review, true);
});
