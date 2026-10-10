import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPersonIntelligence,
  registerLivingDatabaseRoutes
} from '../living-database-routes.js';

const clientId =
  '777b940f-dbc1-44b3-b569-a89661bde598';

const personId =
  '11111111-1111-4111-8111-111111111111';

function result(rows = []) {
  return {
    rows,
    rowCount: rows.length
  };
}

function basePerson() {
  return {
    id: personId,
    full_name: 'Richard Example',
    first_name: 'Richard',
    last_name: 'Example',
    current_title: 'CEO',
    department: 'Executive',
    seniority: 'C-Level',
    contact_city: 'Amsterdam',
    contact_country: 'Netherlands',
    linkedin_url:
      'https://www.linkedin.com/in/richard-example',
    created_at:
      '2026-01-01T00:00:00.000Z',
    updated_at:
      '2026-10-01T00:00:00.000Z',

    primary_email:
      'richard@example.com',
    email_validation_status:
      'valid',
    primary_phone:
      '+31123456789',
    primary_phone_type:
      'mobile',

    employment_id:
      '22222222-2222-4222-8222-222222222222',
    company_id:
      '33333333-3333-4333-8333-333333333333',
    employment_title:
      'CEO',
    employment_department:
      'Executive',
    employment_seniority:
      'C-Level',

    company_name:
      'Example Networks',
    company_domain:
      'example.net',
    company_website:
      'https://example.net',
    company_linkedin_url:
      'https://www.linkedin.com/company/example-networks',
    company_industry:
      'Telecommunications',
    company_description:
      'Network infrastructure company',
    company_founded_date:
      '2010-01-01',
    company_revenue_range:
      '$10M-$50M',
    company_staff_count_range:
      '51-200',
    company_street_1:
      '1 Example Street',
    company_city:
      'Amsterdam',
    company_state:
      null,
    company_post_code:
      '1000AA',
    company_country:
      'Netherlands',

    icp_tags: [
      {
        id:
          '44444444-4444-4444-8444-444444444444',
        name:
          'Infrastructure Leaders'
      }
    ]
  };
}

function intelligenceFixture({
  personMissing = false,
  withFreshness = true,
  withEnrichment = true
} = {}) {
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
        normalized.includes('FROM persons p') &&
        normalized.includes(
          "AND p.status = 'active'"
        )
      ) {
        return result(
          personMissing
            ? []
            : [basePerson()]
        );
      }

      if (
        normalized.includes(
          'FROM employments e'
        ) &&
        normalized.includes(
          'LIMIT 100'
        )
      ) {
        return result([
          {
            id:
              '22222222-2222-4222-8222-222222222222',
            company_id:
              '33333333-3333-4333-8333-333333333333',
            company_name:
              'Example Networks',
            title:
              'CEO',
            department:
              'Executive',
            seniority:
              'C-Level',
            is_current:
              true,
            started_at:
              '2020-01-01',
            ended_at:
              null
          }
        ]);
      }

      if (
        normalized.includes(
          'FROM campaign_participations cp'
        )
      ) {
        return result([
          {
            campaign_id:
              '55555555-5555-4555-8555-555555555555',
            campaign_name:
              'Infrastructure Campaign',
            campaign_status:
              'active',
            stage:
              'contacted',
            participation_status:
              'active'
          }
        ]);
      }

      if (
        normalized.includes(
          'FROM campaign_history_events e'
        )
      ) {
        return result([
          {
            id:
              '66666666-6666-4666-8666-666666666666',
            campaign_id:
              '55555555-5555-4555-8555-555555555555',
            campaign_name:
              'Infrastructure Campaign',
            action:
              'participation_updated'
          }
        ]);
      }

      if (
        normalized.includes(
          'FROM person_verifications'
        ) &&
        normalized.includes(
          "'completed'"
        )
      ) {
        return result(
          withFreshness
            ? [
                {
                  id:
                    '77777777-7777-4777-8777-777777777777',
                  client_id:
                    clientId,
                  person_id:
                    personId,
                  status:
                    'completed',
                  freshness_result:
                    'healthy',
                  confidence:
                    94
                }
              ]
            : []
        );
      }

      if (
        normalized.includes(
          'FROM person_verifications'
        ) &&
        normalized.includes(
          "'queued'"
        )
      ) {
        return result([]);
      }

      if (
        normalized.includes(
          'FROM person_enrichment_attributes'
        )
      ) {
        return result(
          withEnrichment
            ? [
                {
                  attribute_key:
                    'asn',
                  attribute_label:
                    'ASN',
                  value:
                    64500,
                  value_type:
                    'number',
                  source_name:
                    'hermes',
                  confidence:
                    95
                }
              ]
            : []
        );
      }

      throw new Error(
        `Unexpected query: ${normalized}`
      );
    }
  };

  return {
    client,
    calls
  };
}

test(
  'invalid intelligence scope is rejected before database access',
  async () => {
    let queried = false;

    const client = {
      async query() {
        queried = true;
        return result();
      }
    };

    await assert.rejects(
      getPersonIntelligence(
        client,
        {
          clientId,
          personId: 'not-a-uuid'
        }
      ),
      /INVALID_PERSON_INTELLIGENCE_SCOPE/
    );

    assert.equal(
      queried,
      false
    );
  }
);

test(
  'missing active person returns null and stops before secondary reads',
  async () => {
    const fixture =
      intelligenceFixture({
        personMissing: true
      });

    const data =
      await getPersonIntelligence(
        fixture.client,
        {
          clientId,
          personId
        }
      );

    assert.equal(
      data,
      null
    );

    assert.equal(
      fixture.calls.length,
      1
    );
  }
);

test(
  'person intelligence composes canonical, client-scoped and living database data',
  async () => {
    const fixture =
      intelligenceFixture();

    const data =
      await getPersonIntelligence(
        fixture.client,
        {
          clientId,
          personId
        }
      );

    assert.equal(
      data.person.id,
      personId
    );

    assert.equal(
      data.person.full_name,
      'Richard Example'
    );

    assert.equal(
      data.contact.primary_email,
      'richard@example.com'
    );

    assert.equal(
      data.company.name,
      'Example Networks'
    );

    assert.equal(
      data.current_employment.title,
      'CEO'
    );

    assert.equal(
      data.employment_history.length,
      1
    );

    assert.equal(
      data.icp_tags.length,
      1
    );

    assert.equal(
      data.freshness.latest.freshness_result,
      'healthy'
    );

    assert.equal(
      data.freshness.open,
      null
    );

    assert.equal(
      data.enrichment.length,
      1
    );

    assert.equal(
      data.campaigns.length,
      1
    );

    assert.equal(
      data.campaign_events.length,
      1
    );
  }
);

test(
  'client-specific intelligence queries carry authenticated client scope',
  async () => {
    const fixture =
      intelligenceFixture();

    await getPersonIntelligence(
      fixture.client,
      {
        clientId,
        personId
      }
    );

    const personQuery =
      fixture.calls.find(call =>
        call.sql.includes(
          'FROM persons p'
        )
      );

    assert.deepEqual(
      personQuery.params,
      [
        personId,
        clientId
      ]
    );

    const campaignQuery =
      fixture.calls.find(call =>
        call.sql.includes(
          'FROM campaign_participations cp'
        )
      );

    assert.deepEqual(
      campaignQuery.params,
      [
        personId,
        clientId
      ]
    );

    const eventQuery =
      fixture.calls.find(call =>
        call.sql.includes(
          'FROM campaign_history_events e'
        )
      );

    assert.deepEqual(
      eventQuery.params,
      [
        personId,
        clientId
      ]
    );

    const livingQueries =
      fixture.calls.filter(call =>
        call.sql.includes(
          'FROM person_verifications'
        ) ||
        call.sql.includes(
          'FROM person_enrichment_attributes'
        )
      );

    for (
      const call
      of livingQueries
    ) {
      assert.deepEqual(
        call.params,
        [
          clientId,
          personId
        ]
      );
    }
  }
);

test(
  'unverified person returns explicit empty freshness and enrichment state',
  async () => {
    const fixture =
      intelligenceFixture({
        withFreshness: false,
        withEnrichment: false
      });

    const data =
      await getPersonIntelligence(
        fixture.client,
        {
          clientId,
          personId
        }
      );

    assert.equal(
      data.freshness.latest,
      null
    );

    assert.equal(
      data.freshness.open,
      null
    );

    assert.deepEqual(
      data.enrichment,
      []
    );
  }
);

test(
  'route rejects unauthenticated request before opening database connection',
  async () => {
    let routeHandler = null;
    let connected = false;

    const app = {
      get(path, handler) {
        assert.equal(
          path,
          '/api/v1/people/:id/intelligence'
        );

        routeHandler = handler;
      }
    };

    const pool = {
      async connect() {
        connected = true;
        throw new Error(
          'should not connect'
        );
      }
    };

    registerLivingDatabaseRoutes(
      app,
      pool
    );

    const response = {
      statusCode: 200,
      body: null,

      status(code) {
        this.statusCode = code;
        return this;
      },

      json(body) {
        this.body = body;
        return this;
      }
    };

    await routeHandler(
      {
        auth: null,
        params: {
          id: personId
        }
      },
      response
    );

    assert.equal(
      response.statusCode,
      401
    );

    assert.equal(
      response.body.code,
      'AUTHENTICATION_REQUIRED'
    );

    assert.equal(
      connected,
      false
    );
  }
);

test(
  'route rejects malformed person id before opening database connection',
  async () => {
    let routeHandler = null;
    let connected = false;

    const app = {
      get(_path, handler) {
        routeHandler = handler;
      }
    };

    const pool = {
      async connect() {
        connected = true;
        throw new Error(
          'should not connect'
        );
      }
    };

    registerLivingDatabaseRoutes(
      app,
      pool
    );

    const response = {
      statusCode: 200,
      body: null,

      status(code) {
        this.statusCode = code;
        return this;
      },

      json(body) {
        this.body = body;
        return this;
      }
    };

    await routeHandler(
      {
        auth: {
          clientId,
          principalId:
            '88888888-8888-4888-8888-888888888888'
        },
        params: {
          id: 'bad-id'
        }
      },
      response
    );

    assert.equal(
      response.statusCode,
      400
    );

    assert.equal(
      response.body.code,
      'INVALID_PERSON_ID'
    );

    assert.equal(
      connected,
      false
    );
  }
);
