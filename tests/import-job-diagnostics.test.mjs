import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImportJobDiagnostics,
  readImportJobDetails
} from '../import-job-diagnostics.js';

test('completed synchronous import has no failure diagnostics', () => {
  assert.deepEqual(
    buildImportJobDiagnostics({
      status: 'completed',
      metadata: {
        input_type: 'csv'
      },
      result_summary: {
        total: 2,
        inserted: 2
      }
    }),
    {
      async: false,
      failure_code: null,
      error_code: null,
      retry_count: null,
      retryable: false,
      legacy_failure: false
    }
  );
});

test('failed asynchronous import is retryable', () => {
  assert.deepEqual(
    buildImportJobDiagnostics({
      status: 'failed',
      metadata: {
        async: true
      },
      result_summary: {
        status: 'failed',
        code: 'ASYNC_IMPORT_FAILED',
        error_code: 'TEST_WORKER_FAILURE',
        retry_count: 4
      }
    }),
    {
      async: true,
      failure_code: 'ASYNC_IMPORT_FAILED',
      error_code: 'TEST_WORKER_FAILURE',
      retry_count: 4,
      retryable: true,
      legacy_failure: false
    }
  );
});

test('structured synchronous failure is not retryable', () => {
  assert.deepEqual(
    buildImportJobDiagnostics({
      status: 'failed',
      metadata: {
        async: false
      },
      result_summary: {
        status: 'failed',
        code: 'IMPORT_FAILED',
        error_code: 'TEST_IMPORT_FAILURE'
      }
    }),
    {
      async: false,
      failure_code: 'IMPORT_FAILED',
      error_code: 'TEST_IMPORT_FAILURE',
      retry_count: null,
      retryable: false,
      legacy_failure: false
    }
  );
});

test('old failed import with empty summary is marked legacy', () => {
  assert.deepEqual(
    buildImportJobDiagnostics({
      status: 'failed',
      metadata: {},
      result_summary: {}
    }),
    {
      async: false,
      failure_code: null,
      error_code: null,
      retry_count: null,
      retryable: false,
      legacy_failure: true
    }
  );
});

test('job details are scoped by import job and client', async () => {
  const calls = [];

  const db = {
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql.includes('FROM import_jobs')) {
        return {
          rowCount: 1,
          rows: [{
            id: params[0],
            client_id: params[1],
            status: 'completed',
            metadata: {},
            result_summary: {}
          }]
        };
      }

      if (sql.includes('FROM audit_events')) {
        return {
          rowCount: 1,
          rows: [{
            action: 'import.completed',
            created_at: '2026-10-09T00:00:00Z',
            details: { total: 1 }
          }]
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  const result = await readImportJobDetails(
    db,
    '577a7a59-2268-424b-a2e3-bd10be46022e',
    '777b940f-dbc1-44b3-b569-a89661bde598'
  );

  assert.equal(calls.length, 2);

  assert.match(
    calls[0].sql,
    /AND client_id = \$2/
  );

  assert.deepEqual(
    calls[0].params,
    [
      '577a7a59-2268-424b-a2e3-bd10be46022e',
      '777b940f-dbc1-44b3-b569-a89661bde598'
    ]
  );

  assert.match(
    calls[1].sql,
    /AND client_id = \$2/
  );

  assert.equal(
    result.job.status,
    'completed'
  );

  assert.equal(
    result.events[0].action,
    'import.completed'
  );
});

test('foreign-client or missing job stops before audit events are read', async () => {
  const calls = [];

  const db = {
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql.includes('FROM import_jobs')) {
        return {
          rowCount: 0,
          rows: []
        };
      }

      throw new Error(
        'Audit events must not be queried'
      );
    }
  };

  const result = await readImportJobDetails(
    db,
    '577a7a59-2268-424b-a2e3-bd10be46022e',
    '777b940f-dbc1-44b3-b569-a89661bde598'
  );

  assert.equal(result, null);
  assert.equal(calls.length, 1);

  assert.match(
    calls[0].sql,
    /AND client_id = \$2/
  );
});
