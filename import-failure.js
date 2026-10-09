export async function persistSynchronousImportFailure(
  client,
  {
    importJobId,
    clientId,
    errorCode = null
  }
) {
  const summary = {
    status: 'failed',
    code: 'IMPORT_FAILED',
    error_code: errorCode,
    processed: 0
  };

  const failedJob = await client.query(
    `
      UPDATE import_jobs
      SET
        status = 'failed',
        completed_at = NOW(),
        result_summary = $2::jsonb
      WHERE id = $1
      RETURNING id
    `,
    [
      importJobId,
      JSON.stringify(summary)
    ]
  );

  if (failedJob.rowCount === 1) {
    await client.query(
      `
        INSERT INTO audit_events (
          actor,
          action,
          entity_type,
          entity_id,
          client_id,
          details
        )
        VALUES (
          'lumina-bridge',
          'import.failed',
          'import_job',
          $1,
          $2,
          $3::jsonb
        )
      `,
      [
        importJobId,
        clientId,
        JSON.stringify({
          code: 'IMPORT_FAILED',
          error_code: errorCode,
          processed: 0
        })
      ]
    );
  }

  return {
    persisted: failedJob.rowCount === 1,
    summary
  };
}
