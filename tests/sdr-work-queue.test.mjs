import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSdrWorkItem
} from '../sdr-work-queue.js';

test('active campaign stages map to explicit SDR next actions', () => {
  const cases = [
    ['not_started', 'start_outreach'],
    ['contacted', 'follow_up'],
    ['responded', 'review_response'],
    ['meeting_booked', 'prepare_meeting'],
    ['qualified', 'progress_opportunity'],
    ['closed', 'complete']
  ];

  for (const [stage, expectedAction] of cases) {
    const result = buildSdrWorkItem({
      participation: {
        stage,
        status: 'active',
        first_contacted_at: null,
        last_contacted_at: null
      },
      now: '2026-10-11T12:00:00.000Z'
    });

    assert.equal(result.next_action, expectedAction);
    assert.equal(result.actionable, expectedAction !== 'complete');
    assert.ok(result.reasons.includes(`stage_${stage}`));
  }
});

test('participation status overrides stage when work should stop', () => {
  const cases = [
    ['paused', 'no_action'],
    ['completed', 'complete'],
    ['not_interested', 'do_not_pursue']
  ];

  for (const [status, expectedAction] of cases) {
    const result = buildSdrWorkItem({
      participation: {
        stage: 'contacted',
        status,
        first_contacted_at: '2026-10-01T00:00:00.000Z',
        last_contacted_at: '2026-10-10T00:00:00.000Z'
      },
      now: '2026-10-11T12:00:00.000Z'
    });

    assert.equal(result.next_action, expectedAction);
    assert.equal(result.actionable, false);
    assert.ok(result.reasons.includes(`status_${status}`));
  }
});

test('contacted participant exposes deterministic follow-up timing', () => {
  const result = buildSdrWorkItem({
    participation: {
      stage: 'contacted',
      status: 'active',
      first_contacted_at: '2026-10-06T00:00:00.000Z',
      last_contacted_at: '2026-10-08T00:00:00.000Z'
    },
    now: '2026-10-11T12:00:00.000Z',
    followUpAfterHours: 72
  });

  assert.equal(result.next_action, 'follow_up');
  assert.equal(
    result.follow_up_due_at,
    '2026-10-11T00:00:00.000Z'
  );
  assert.equal(result.follow_up_overdue, true);
  assert.ok(result.reasons.includes('follow_up_overdue'));
});

test('follow-up timing is not fabricated when no contact timestamp exists', () => {
  const result = buildSdrWorkItem({
    participation: {
      stage: 'contacted',
      status: 'active',
      first_contacted_at: null,
      last_contacted_at: null
    },
    now: '2026-10-11T12:00:00.000Z',
    followUpAfterHours: 72
  });

  assert.equal(result.next_action, 'follow_up');
  assert.equal(result.follow_up_due_at, null);
  assert.equal(result.follow_up_overdue, false);
  assert.ok(result.reasons.includes('contact_timestamp_missing'));
});

test('SDR work item remains explainable and does not invent an AI score', () => {
  const result = buildSdrWorkItem({
    participation: {
      stage: 'responded',
      status: 'active',
      first_contacted_at: '2026-10-09T00:00:00.000Z',
      last_contacted_at: '2026-10-10T00:00:00.000Z'
    },
    now: '2026-10-11T12:00:00.000Z'
  });

  assert.equal(result.next_action, 'review_response');
  assert.ok(Array.isArray(result.reasons));
  assert.ok(result.reasons.length > 0);

  assert.equal(Object.hasOwn(result, 'score'), false);
  assert.equal(Object.hasOwn(result, 'ai_score'), false);
  assert.equal(Object.hasOwn(result, 'priority_score'), false);
});
