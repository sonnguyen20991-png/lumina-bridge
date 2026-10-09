import test from 'node:test';
import assert from 'node:assert/strict';

import {
  queuePersonVerification,
  claimNextPersonVerification,
  completePersonVerification,
  failPersonVerification,
  recordPersonEnrichmentObservation,
  getPersonFreshness,
  getPersonEnrichment
} from '../living-database-store.js';

const clientId =
  '777b940f-dbc1-44b3-b569-a89661bde598';

const personId =
  '11111111-1111-4111-8111-111111111111';

const verificationId =
  '22222222-2222-4222-8222-222222222222';

const observationId =
  '33333333-3333-4333-8333-333333333333';

function result(rows = []) {
  return {
    rows,
    rowCount: rows.length
  };
}

function enrichmentFixture(options = {}) {
  const calls = [];
  let released = 0;

  const db = {
    async query(sql, params = []) {
      calls.push({
        sql: sql.trim(),
        params
      });

      if (
        sql === 'BEGIN' ||
        sql === 'COMMIT' ||
        sql === 'ROLLBACK'
      ) {
        return result();
      }

      if (
        sql.includes('FROM persons') &&
        sql.includes('FOR SHARE')
      ) {
        return result(
          options.personMissing
            ? []
            : [{ id: personId }]
        );
      }

      if (
        sql.includes('FROM person_verifications') &&
        sql.includes('FOR SHARE')
      ) {
        return result(
          options.verificationMismatch
            ? []
            : [{ id: verificationId }]
        );
      }

      if (
        sql.includes(
          'INSERT INTO person_enrichment_observations'
        )
      ) {
        return result([
          {
            id: observationId,
            client_id: clientId,
            person_id: personId,
            attribute_key: 'asn',
            observed_value: 64500,
            decision:
              params[11]
          }
        ]);
      }

      if (
        sql.includes(
          'INSERT INTO person_enrichment_attributes'
        )
      ) {
        if (options.promotionFails) {
          throw new Error('promotion failed');
        }

        return result([
          {
            id:
              '44444444-4444-4444-8444-444444444444',
            client_id: clientId,
            person_id: personId,
            attribute_key: 'asn',
            value: 64500,
            current_observation_id:
              observationId
          }
        ]);
      }

      throw new Error(
        `Unexpected query: ${sql}`
      );
    },

    release() {
      released += 1;
    }
  };

  return {
    pool: {
      connect: async () => db
    },
    calls,
    get released() {
      return released;
    }
  };
}

test(
  'accepted enrichment stores immutable observation then promotes current value in one transaction',
  async () => {
    const fixture =
      enrichmentFixture();

    const value =
      await recordPersonEnrichmentObservation(
        fixture.pool,
        {
          clientId,
          personId,
          attributeKey: 'asn',
          attributeLabel: 'ASN',
          value: 64500,
          valueType: 'number',
          sourceName: 'hermes',
          confidence: 95,
          verificationId,
          decision: 'accepted',
          metadata: {
            evidence: 'public_source'
          }
        }
      );

    assert.equal(
      value.observation.id,
      observationId
    );

    assert.equal(
      value.current.current_observation_id,
      observationId
    );

    const statements =
      fixture.calls.map(call => call.sql);

    assert.equal(
      statements[0],
      'BEGIN'
    );

    const observationIndex =
      statements.findIndex(sql =>
        sql.includes(
          'INSERT INTO person_enrichment_observations'
        )
      );

    const promotionIndex =
      statements.findIndex(sql =>
        sql.includes(
          'INSERT INTO person_enrichment_attributes'
        )
      );

    assert.ok(
      observationIndex > 0
    );

    assert.ok(
      promotionIndex > observationIndex
    );

    assert.equal(
      statements.at(-1),
      'COMMIT'
    );

    assert.equal(
      fixture.released,
      1
    );
  }
);

test(
  'needs-review enrichment preserves evidence without changing current state',
  async () => {
    const fixture =
      enrichmentFixture();

    const value =
      await recordPersonEnrichmentObservation(
        fixture.pool,
        {
          clientId,
          personId,
          attributeKey: 'asn',
          value: 64500,
          valueType: 'number',
          sourceName: 'hermes',
          confidence: 60,
          verificationId,
          decision: 'needs_review'
        }
      );

    assert.equal(
      value.observation.id,
      observationId
    );

    assert.equal(
      value.current,
      null
    );

    assert.equal(
      fixture.calls.some(call =>
        call.sql.includes(
          'INSERT INTO person_enrichment_attributes'
        )
      ),
      false
    );

    assert.equal(
      fixture.calls.at(-1).sql,
      'COMMIT'
    );
  }
);

test(
  'cross-client verification mismatch rolls back before evidence is inserted',
  async () => {
    const fixture =
      enrichmentFixture({
        verificationMismatch: true
      });

    await assert.rejects(
      recordPersonEnrichmentObservation(
        fixture.pool,
        {
          clientId,
          personId,
          attributeKey: 'asn',
          value: 64500,
          valueType: 'number',
          sourceName: 'hermes',
          verificationId,
          decision: 'accepted'
        }
      ),
      /VERIFICATION_SCOPE_MISMATCH/
    );

    assert.equal(
      fixture.calls.some(call =>
        call.sql.includes(
          'INSERT INTO person_enrichment_observations'
        )
      ),
      false
    );

    assert.equal(
      fixture.calls.at(-1).sql,
      'ROLLBACK'
    );

    assert.equal(
      fixture.released,
      1
    );
  }
);

test(
  'promotion failure rolls back observation and current-state transaction',
  async () => {
    const fixture =
      enrichmentFixture({
        promotionFails: true
      });

    await assert.rejects(
      recordPersonEnrichmentObservation(
        fixture.pool,
        {
          clientId,
          personId,
          attributeKey: 'asn',
          value: 64500,
          valueType: 'number',
          sourceName: 'hermes',
          verificationId,
          decision: 'accepted'
        }
      ),
      /promotion failed/
    );

    assert.equal(
      fixture.calls.some(call =>
        call.sql.includes(
          'INSERT INTO person_enrichment_observations'
        )
      ),
      true
    );

    assert.equal(
      fixture.calls.at(-1).sql,
      'ROLLBACK'
    );

    assert.equal(
      fixture.released,
      1
    );
  }
);

test(
  'queue verification deduplicates open work for the same client and person',
  async () => {
    const calls = [];

    const db = {
      async query(sql, params = []) {
        calls.push({
          sql,
          params
        });

        if (sql.includes('FROM persons')) {
          return result([
            { id: personId }
          ]);
        }

        if (
          sql.includes(
            'INSERT INTO person_verifications'
          )
        ) {
          return result([
            {
              id: verificationId,
              client_id: clientId,
              person_id: personId,
              status: 'queued'
            }
          ]);
        }

        throw new Error(
          `Unexpected query: ${sql}`
        );
      }
    };

    const queued =
      await queuePersonVerification(
        db,
        {
          clientId,
          personId,
          requestedBy: 'test',
          verificationType:
            'on_demand',
          metadata: {
            reason: 'test'
          }
        }
      );

    assert.equal(
      queued.id,
      verificationId
    );

    const insert =
      calls.find(call =>
        call.sql.includes(
          'INSERT INTO person_verifications'
        )
      );

    assert.ok(
      insert.sql.includes(
        "WHERE status IN ('queued', 'running')"
      )
    );

    assert.equal(
      insert.params[0],
      clientId
    );

    assert.equal(
      insert.params[1],
      personId
    );
  }
);

test(
  'claim uses skip-locked queue semantics',
  async () => {
    let captured = null;

    const db = {
      async query(sql, params = []) {
        captured = {
          sql,
          params
        };

        return result([
          {
            id: verificationId,
            client_id: clientId,
            person_id: personId,
            status: 'running'
          }
        ]);
      }
    };

    const claimed =
      await claimNextPersonVerification(
        db,
        {
          clientId
        }
      );

    assert.equal(
      claimed.id,
      verificationId
    );

    assert.ok(
      captured.sql.includes(
        'FOR UPDATE SKIP LOCKED'
      )
    );

    assert.ok(
      captured.sql.includes(
        "status = 'running'"
      )
    );

    assert.equal(
      captured.params[0],
      clientId
    );
  }
);

test(
  'completion is scoped to verification, client and person',
  async () => {
    let captured = null;

    const db = {
      async query(sql, params = []) {
        captured = {
          sql,
          params
        };

        return result([
          {
            id: verificationId,
            status: 'completed',
            freshness_result:
              'healthy'
          }
        ]);
      }
    };

    const completed =
      await completePersonVerification(
        db,
        {
          verificationId,
          clientId,
          personId,
          freshnessResult:
            'healthy',
          confidence: 94,
          sourcesChecked: [
            'company_site'
          ],
          summary: {
            changed: false
          }
        }
      );

    assert.equal(
      completed.status,
      'completed'
    );

    assert.ok(
      captured.sql.includes(
        'AND client_id = $2'
      )
    );

    assert.ok(
      captured.sql.includes(
        'AND person_id = $3'
      )
    );

    assert.ok(
      captured.sql.includes(
        "AND status = 'running'"
      )
    );
  }
);

test(
  'failed verification becomes unverified without deleting person data',
  async () => {
    let captured = null;

    const db = {
      async query(sql, params = []) {
        captured = {
          sql,
          params
        };

        return result([
          {
            id: verificationId,
            status: 'failed',
            freshness_result:
              'unverified'
          }
        ]);
      }
    };

    const failed =
      await failPersonVerification(
        db,
        {
          verificationId,
          clientId,
          personId,
          summary: {
            reason:
              'source temporarily unavailable'
          }
        }
      );

    assert.equal(
      failed.status,
      'failed'
    );

    assert.equal(
      failed.freshness_result,
      'unverified'
    );

    assert.ok(
      captured.sql.includes(
        "freshness_result = 'unverified'"
      )
    );

    assert.equal(
      /DELETE FROM persons/.test(
        captured.sql
      ),
      false
    );
  }
);

test(
  'freshness and enrichment reads are client and person scoped',
  async () => {
    const calls = [];

    const db = {
      async query(sql, params = []) {
        calls.push({
          sql,
          params
        });

        if (
          sql.includes(
            'FROM person_enrichment_attributes'
          )
        ) {
          return result([
            {
              attribute_key: 'asn',
              value: 64500
            }
          ]);
        }

        return result([]);
      }
    };

    const freshness =
      await getPersonFreshness(
        db,
        {
          clientId,
          personId
        }
      );

    const enrichment =
      await getPersonEnrichment(
        db,
        {
          clientId,
          personId
        }
      );

    assert.equal(
      freshness.latest,
      null
    );

    assert.equal(
      freshness.open,
      null
    );

    assert.equal(
      enrichment.length,
      1
    );

    for (const call of calls) {
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
  'invalid confidence is rejected before enrichment transaction opens',
  async () => {
    let connected = false;

    const pool = {
      async connect() {
        connected = true;

        throw new Error(
          'should not connect'
        );
      }
    };

    await assert.rejects(
      recordPersonEnrichmentObservation(
        pool,
        {
          clientId,
          personId,
          attributeKey: 'asn',
          value: 64500,
          valueType: 'number',
          sourceName: 'hermes',
          confidence: 101,
          decision: 'accepted'
        }
      ),
      /INVALID_CONFIDENCE/
    );

    assert.equal(
      connected,
      false
    );
  }
);
