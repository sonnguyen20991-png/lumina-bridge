const ACTIVE_STAGE_ACTIONS = Object.freeze({
  not_started: 'start_outreach',
  contacted: 'follow_up',
  responded: 'review_response',
  meeting_booked: 'prepare_meeting',
  qualified: 'progress_opportunity',
  closed: 'complete'
});

const STATUS_OVERRIDES = Object.freeze({
  paused: 'no_action',
  completed: 'complete',
  not_interested: 'do_not_pursue'
});

function validDate(value) {
  if (typeof value !== 'string' || !value) return null;

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) return null;

  return timestamp;
}

function iso(timestamp) {
  return new Date(timestamp).toISOString();
}

export function buildSdrWorkItem({
  participation,
  now = new Date().toISOString(),
  followUpAfterHours = 72
} = {}) {
  const stage = participation?.stage || null;
  const status = participation?.status || null;

  const reasons = [];

  let nextAction;
  let actionable;

  if (Object.hasOwn(STATUS_OVERRIDES, status)) {
    nextAction = STATUS_OVERRIDES[status];
    actionable = false;
    reasons.push(`status_${status}`);
  } else if (
    status === 'active' &&
    Object.hasOwn(ACTIVE_STAGE_ACTIONS, stage)
  ) {
    nextAction = ACTIVE_STAGE_ACTIONS[stage];
    actionable = nextAction !== 'complete';
    reasons.push(`stage_${stage}`);
  } else {
    nextAction = 'no_action';
    actionable = false;

    if (status) {
      reasons.push(`status_${status}`);
    } else {
      reasons.push('status_missing');
    }

    if (stage) {
      reasons.push(`stage_${stage}`);
    } else {
      reasons.push('stage_missing');
    }

    reasons.push('unsupported_participation_state');
  }

  let followUpDueAt = null;
  let followUpOverdue = false;

  if (nextAction === 'follow_up') {
    const lastContactedAt =
      validDate(participation?.last_contacted_at) ??
      validDate(participation?.first_contacted_at);

    if (lastContactedAt === null) {
      reasons.push('contact_timestamp_missing');
    } else {
      const hours = Number(followUpAfterHours);

      if (Number.isFinite(hours) && hours >= 0) {
        const dueTimestamp =
          lastContactedAt + hours * 60 * 60 * 1000;

        followUpDueAt = iso(dueTimestamp);

        const nowTimestamp = validDate(now);

        if (
          nowTimestamp !== null &&
          nowTimestamp >= dueTimestamp
        ) {
          followUpOverdue = true;
          reasons.push('follow_up_overdue');
        } else {
          reasons.push('follow_up_not_due');
        }
      } else {
        reasons.push('follow_up_policy_invalid');
      }
    }
  }

  return {
    next_action: nextAction,
    actionable,
    follow_up_due_at: followUpDueAt,
    follow_up_overdue: followUpOverdue,
    reasons
  };
}
