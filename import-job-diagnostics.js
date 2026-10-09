export function buildImportJobDiagnostics(job) {
  const metadata =
    job?.metadata &&
    typeof job.metadata === 'object' &&
    !Array.isArray(job.metadata)
      ? job.metadata
      : {};

  const summary =
    job?.result_summary &&
    typeof job.result_summary === 'object' &&
    !Array.isArray(job.result_summary)
      ? job.result_summary
      : {};

  const failed = job?.status === 'failed';
  const asyncJob = metadata.async === true;

  const failureCode =
    failed &&
    typeof summary.code === 'string' &&
    summary.code.trim()
      ? summary.code.trim()
      : null;

  const errorCode =
    failed &&
    typeof summary.error_code === 'string' &&
    summary.error_code.trim()
      ? summary.error_code.trim()
      : null;

  const retryCount =
    Number.isInteger(summary.retry_count) &&
    summary.retry_count >= 0
      ? summary.retry_count
      : null;

  return {
    async: asyncJob,
    failure_code: failureCode,
    error_code: errorCode,
    retry_count: retryCount,
    retryable: failed && asyncJob,
    legacy_failure:
      failed &&
      failureCode === null &&
      errorCode === null
  };
}

export async function readImportJobDetails(
  db,
  importJobId,
  clientId
) {
  const result = await db.query(
    `
      SELECT
        id,
        client_id,
        filename,
        source_name,
        status,
        total_rows,
        processed_rows,
        inserted_rows,
        updated_rows,
        matched_rows,
        duplicate_rows,
        rejected_rows,
        conflict_rows,
        suppressed_rows,
        started_at,
        completed_at,
        metadata,
        result_summary,
        created_at
      FROM import_jobs
      WHERE id = $1
        AND client_id = $2
      LIMIT 1
    `,
    [
      importJobId,
      clientId
    ]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  const job = result.rows[0];

  const eventResult = await db.query(
    `
      SELECT
        action,
        created_at,
        details
      FROM audit_events
      WHERE entity_type = 'import_job'
        AND entity_id = $1
        AND client_id = $2
      ORDER BY created_at, id
    `,
    [
      importJobId,
      clientId
    ]
  );

  return {
    job,
    events: eventResult.rows
  };
}
