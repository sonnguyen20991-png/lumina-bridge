function text(value, max = 1000) {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();

  return cleaned
    ? cleaned.slice(0, max)
    : null;
}

function uniqueText(values) {
  return [
    ...new Set(
      values
        .map(value => text(value, 1000))
        .filter(Boolean)
    )
  ];
}

/**
 * Find an ACTIVE suppression before canonical mutation.
 *
 * Scope:
 *   client_id IS NULL  -> global
 *   client_id = input  -> client-specific
 *
 * Supported:
 *   email
 *   domain
 *   phone
 *   person
 *   company
 */
export async function findSuppression(
  client,
  {
    row,
    clientId,
    sourceName,
    sourceRecordId
  }
) {
  const email =
    text(row.email, 500);

  const linkedIn =
    text(row.linkedin_url, 1000);

  const companyDomains =
    uniqueText([
      row.company_domain,
      row.company_website
    ]);

  const companyLinkedIn =
    text(row.company_linkedin_url, 1000);

  const phones =
    uniqueText([
      row.phone,
      row.Phone,

      row.contact_phone_1,
      row.contact_phone1,
      row.contactPhone1,
      row.ContactPhone1,

      row.contact_phone_2,
      row.contact_phone2,
      row.contactPhone2,
      row.ContactPhone2,

      row.mobile_phone,
      row.mobilePhone,
      row.MobilePhone,

      row.company_phone_1,
      row.company_phone1,
      row.companyPhone1,
      row.CompanyPhone1,

      row.company_phone_2,
      row.company_phone2,
      row.companyPhone2,
      row.CompanyPhone2
    ]);

  const result = await client.query(
    `
      WITH input AS (
        SELECT
          $1::uuid AS client_id,
          $2::text AS source_name,
          $3::text AS source_record_id,
          $4::text AS email,
          $5::text AS linkedin_url,
          $6::text[] AS company_domains,
          $7::text AS company_linkedin_url,
          $8::text[] AS phones
      ),

      person_candidates AS (
        SELECT sr.canonical_person_id AS id
        FROM source_records sr
        CROSS JOIN input i
        WHERE i.source_record_id IS NOT NULL
          AND sr.source_name = i.source_name
          AND sr.source_record_id =
              i.source_record_id
          AND sr.canonical_person_id IS NOT NULL

        UNION

        SELECT p.id
        FROM persons p
        CROSS JOIN input i
        WHERE i.linkedin_url IS NOT NULL
          AND p.normalized_linkedin_url =
              lumina_normalize_linkedin(
                i.linkedin_url
              )

        UNION

        SELECT e.person_id
        FROM emails e
        CROSS JOIN input i
        WHERE i.email IS NOT NULL
          AND e.normalized_email =
              lumina_normalize_email(
                i.email
              )
      ),

      company_candidates AS (
        -- Existing source company is only a fallback when the
        -- incoming row has no strong current-company identity.
        SELECT sr.canonical_company_id AS id
        FROM source_records sr
        CROSS JOIN input i
        WHERE i.source_record_id IS NOT NULL
          AND CARDINALITY(
                i.company_domains
              ) = 0
          AND i.company_linkedin_url IS NULL
          AND sr.source_name = i.source_name
          AND sr.source_record_id =
              i.source_record_id
          AND sr.canonical_company_id IS NOT NULL

        UNION

        SELECT c.id
        FROM companies c
        CROSS JOIN input i
        WHERE EXISTS (
          SELECT 1
          FROM UNNEST(
            i.company_domains
          ) AS domain_value
          WHERE c.normalized_domain =
                lumina_normalize_domain(
                  domain_value
                )
        )

        UNION

        SELECT c.id
        FROM companies c
        CROSS JOIN input i
        WHERE i.company_linkedin_url IS NOT NULL
          AND c.normalized_linkedin_url =
              lumina_normalize_linkedin(
                i.company_linkedin_url
              )
      )

      SELECT
        s.id,
        s.client_id,
        s.suppression_type,
        s.person_id,
        s.company_id,
        s.normalized_value,
        s.reason,
        CASE
          WHEN s.client_id IS NULL
            THEN 'global'
          ELSE 'client'
        END AS suppression_scope
      FROM suppressions s
      CROSS JOIN input i
      WHERE s.status = 'active'

        AND (
          s.client_id IS NULL
          OR s.client_id = i.client_id
        )

        AND (
          (
            s.suppression_type = 'email'
            AND i.email IS NOT NULL
            AND s.normalized_value =
                lumina_normalize_email(
                  i.email
                )
          )

          OR

          (
            s.suppression_type = 'domain'
            AND EXISTS (
              SELECT 1
              FROM UNNEST(
                i.company_domains
              ) AS domain_value
              WHERE s.normalized_value =
                    lumina_normalize_domain(
                      domain_value
                    )
            )
          )

          OR

          (
            s.suppression_type = 'phone'
            AND EXISTS (
              SELECT 1
              FROM UNNEST(
                i.phones
              ) AS phone_value
              WHERE s.normalized_value =
                    lumina_normalize_phone(
                      phone_value
                    )
            )
          )

          OR

          (
            s.suppression_type = 'person'
            AND s.person_id IN (
              SELECT id
              FROM person_candidates
            )
          )

          OR

          (
            s.suppression_type = 'company'
            AND s.company_id IN (
              SELECT id
              FROM company_candidates
            )
          )
        )

      ORDER BY
        CASE
          WHEN s.client_id IS NOT NULL
            THEN 0
          ELSE 1
        END,
        s.id

      LIMIT 1
    `,
    [
      clientId || null,
      sourceName,
      sourceRecordId,
      email,
      linkedIn,
      companyDomains,
      companyLinkedIn,
      phones
    ]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const match = result.rows[0];

  return {
    id: match.id,
    clientId: match.client_id,
    type: match.suppression_type,
    personId: match.person_id,
    companyId: match.company_id,
    normalizedValue: match.normalized_value,
    reason: match.reason,
    scope: match.suppression_scope
  };
}

/**
 * Persist the reason a raw import row was blocked.
 */
export async function recordSuppressionHit(
  client,
  {
    suppression,
    rawRowId,
    importJobId,
    rowNumber,
    sourceName,
    sourceRecordId
  }
) {
  await client.query(
    `
      UPDATE raw_source_rows
      SET
        processing_status = 'suppressed',
        processing_error =
          'Blocked by active suppression',
        suppression_id = $2,
        resolution_method = $3,
        resolution_score = 0,
        resolution_notes = $4::jsonb
      WHERE id = $1
    `,
    [
      rawRowId,
      suppression.id,
      `suppressed_${suppression.type}`,
      JSON.stringify({
        suppression_id:
          suppression.id,
        suppression_type:
          suppression.type,
        suppression_scope:
          suppression.scope,
        suppression_reason:
          suppression.reason,
        source_name:
          sourceName,
        source_record_id:
          sourceRecordId
      })
    ]
  );

  await client.query(
    `
      INSERT INTO audit_events (
        actor,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES (
        'lumina-bridge',
        'import.row_suppressed',
        'raw_source_row',
        $1,
        $2::jsonb
      )
    `,
    [
      rawRowId,
      JSON.stringify({
        import_job_id:
          importJobId,
        row_number:
          rowNumber,
        suppression_id:
          suppression.id,
        suppression_type:
          suppression.type,
        suppression_scope:
          suppression.scope,
        suppression_reason:
          suppression.reason
      })
    ]
  );
}
