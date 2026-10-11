import test from 'node:test';
import assert from 'node:assert/strict';

import {
  registerCampaignRoutes
} from '../campaign-routes.js';

const clientId =
  '777b940f-dbc1-44b3-b569-a89661bde598';

const principalId =
  '88888888-8888-4888-8888-888888888888';

const campaignId =
  '55555555-5555-4555-8555-555555555555';

const personId =
  '11111111-1111-4111-8111-111111111111';

function result(rows = []) {
  return {
    rows,
    rowCount: rows.length
  };
}

function createApp() {
  const routes = new Map();

  return {
    routes,
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    }
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    }
  };
}

test('campaign work queue is client scoped and derives explainable SDR actions', async () => {
  const calls = [];

  const client = {
    async query(sql, params = []) {
      const normalized =
        String(sql).replace(/\s+/g, ' ').trim();

      calls.push({
        sql: normalized,
        params
      });

      if (
        normalized.includes(
          'SELECT id FROM campaigns'
        ) &&
        normalized.includes(
          'client_id=$2'
        )
      ) {
        return result([
          {
            id: campaignId
          }
        ]);
      }

      if (
        normalized.includes(
          'FROM campaign_participations cp'
        ) &&
        normalized.includes(
          'JOIN persons p'
        )
      ) {
        return result([
          {
            campaign_id: campaignId,
            person_id: personId,
            stage: 'contacted',
            status: 'active',
            note: 'Initial outreach sent.',
            first_contacted_at:
              '2026-10-06T00:00:00.000Z',
            last_contacted_at:
              '2026-10-08T00:00:00.000Z',
            created_at:
              '2026-10-01T00:00:00.000Z',
            updated_at:
              '2026-10-08T00:00:00.000Z',
            full_name:
              'Richard Example',
            current_title:
              'CEO',
            contact_country:
              'Netherlands',
            company_name:
              'Example Networks'
          }
        ]);
      }

      throw new Error(
        `Unexpected query: ${normalized}`
      );
    },

    release() {}
  };

  const pool = {
    async connect() {
      return client;
    }
  };

  const app = createApp();

  registerCampaignRoutes(app, pool);

  const handler =
    app.routes.get(
      'GET /api/v1/campaigns/:id/work-queue'
    );

  assert.equal(typeof handler, 'function');

  const req = {
    method: 'GET',
    params: {
      id: campaignId
    },
    query: {},
    auth: {
      clientId,
      principalId,
      role: 'member'
    }
  };

  const res = createResponse();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.data.length, 1);

  const item = res.body.data[0];

  assert.equal(item.person_id, personId);
  assert.equal(item.full_name, 'Richard Example');
  assert.equal(item.company_name, 'Example Networks');

  assert.equal(
    item.next_action,
    'follow_up'
  );

  assert.equal(
    item.actionable,
    true
  );

  assert.ok(
    item.reasons.includes('stage_contacted')
  );

  assert.equal(
    Object.hasOwn(item, 'score'),
    false
  );

  const ownershipQuery =
    calls.find(call =>
      call.sql.includes(
        'SELECT id FROM campaigns'
      )
    );

  assert.deepEqual(
    ownershipQuery.params,
    [campaignId, clientId]
  );

  const queueQuery =
    calls.find(call =>
      call.sql.includes(
        'FROM campaign_participations cp'
      )
    );

  assert.ok(queueQuery);
  assert.deepEqual(
    queueQuery.params.slice(0, 2),
    [campaignId, clientId]
  );
});

test('campaign work queue rejects a campaign outside the authenticated client', async () => {
  let queueQueried = false;

  const client = {
    async query(sql) {
      const normalized =
        String(sql).replace(/\s+/g, ' ').trim();

      if (
        normalized.includes(
          'SELECT id FROM campaigns'
        )
      ) {
        return result([]);
      }

      if (
        normalized.includes(
          'FROM campaign_participations cp'
        )
      ) {
        queueQueried = true;
      }

      return result([]);
    },

    release() {}
  };

  const pool = {
    async connect() {
      return client;
    }
  };

  const app = createApp();

  registerCampaignRoutes(app, pool);

  const handler =
    app.routes.get(
      'GET /api/v1/campaigns/:id/work-queue'
    );

  assert.equal(typeof handler, 'function');

  const res = createResponse();

  await handler(
    {
      method: 'GET',
      params: {
        id: campaignId
      },
      query: {},
      auth: {
        clientId,
        principalId,
        role: 'member'
      }
    },
    res
  );

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, {
    status: 'error',
    code: 'CAMPAIGN_NOT_FOUND'
  });

  assert.equal(queueQueried, false);
});

test('campaign work queue rejects invalid campaign ids before querying', async () => {
  let queried = false;

  const pool = {
    async connect() {
      return {
        async query() {
          queried = true;
          return result([]);
        },
        release() {}
      };
    }
  };

  const app = createApp();

  registerCampaignRoutes(app, pool);

  const handler =
    app.routes.get(
      'GET /api/v1/campaigns/:id/work-queue'
    );

  assert.equal(typeof handler, 'function');

  const res = createResponse();

  await handler(
    {
      method: 'GET',
      params: {
        id: 'not-a-uuid'
      },
      query: {},
      auth: {
        clientId,
        principalId,
        role: 'member'
      }
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    status: 'error',
    code: 'INVALID_CAMPAIGN_ID'
  });

  assert.equal(queried, false);
});
