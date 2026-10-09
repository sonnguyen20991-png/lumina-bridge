import test from 'node:test';
import assert from 'node:assert/strict';

import {
  persistSynchronousImportFailure
} from '../import-failure.js';

function makeClient({
  updateRowCount = 1
} = {}) {
  const calls = [];

  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes('UPDATE import_jobs')) {
        return {
          rowCount: updateRowCount,
          rows:
            updateRowCount === 1
              ? [{ id: params[0] }]
              : []
        };
      }

      if (sql.includes('INSERT INTO audit_events')) {
        return {
          rowCount: 1,
          rows: []
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test('persists structured synchronous import failure and audit event', async () => {
  const client = makeClient();

  const result = await persistSynchronousImportFailure(
    client,
    {
      importJobId:
        '577a7a59-2268-424b-a2e3-bd10be46022e',
      clientId:
        '777b940f-dbc1-44b3-b569-a89661bde598',
      errorCode: 'TEST_IMPORT_FAILURE'
    }
  );

  assert.equal(result.persisted, true);

  assert.deepEqual(
    result.summary,
    {
      status: 'failed',
      code: 'IMPORT_FAILED',
      error_code: 'TEST_IMPORT_FAILURE',
      processed: 0
    }
  );

  assert.equal(client.calls.length, 2);

  const update = client.calls[0];
  assert.match(update.sql, /UPDATE import_jobs/);
  assert.match(update.sql, /status = 'failed'/);

  assert.deepEqual(
    JSON.parse(update.params[1]),
    {
      status: 'failed',
      code: 'IMPORT_FAILED',
      error_code: 'TEST_IMPORT_FAILURE',
      processed: 0
    }
  );

  const audit = client.calls[1];
  assert.match(audit.sql, /INSERT INTO audit_events/);

  assert.deepEqual(
    JSON.parse(audit.params[2]),
    {
      code: 'IMPORT_FAILED',
      error_code: 'TEST_IMPORT_FAILURE',
      processed: 0
    }
  );
});

test('does not write audit event when import job is not updated', async () => {
  const client = makeClient({
    updateRowCount: 0
  });

  const result = await persistSynchronousImportFailure(
    client,
    {
      importJobId:
        '577a7a59-2268-424b-a2e3-bd10be46022e',
      clientId:
        '777b940f-dbc1-44b3-b569-a89661bde598',
      errorCode: null
    }
  );

  assert.equal(result.persisted, false);
  assert.equal(client.calls.length, 1);
});
