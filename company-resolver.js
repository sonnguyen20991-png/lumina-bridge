import { evaluateCompanyFieldPolicies } from './company-field-policy.js';

function text(value, max = 1000) {
  if (typeof value !== 'string') return null;

  const cleaned = value.trim();

  return cleaned
    ? cleaned.slice(0, max)
    : null;
}

// founded_date is stored as PostgreSQL DATE.
//
// Only accept a real full ISO calendar date (YYYY-MM-DD).
// Do not invent month/day precision for inputs such as "2019",
// and do not allow malformed source data to abort an import.
function dateText(value) {
  const cleaned = text(value, 50);

  if (!cleaned) {
    return null;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const candidate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return cleaned;
}

export async function resolveCompany(
  client,
  {
    row,
    sourceName,
    sourceRecordId,
    importJobId,
    rawRowId,
    rowHash
  }
) {
  const companyName =
    text(row.company_name, 300);

  const companyDomain =
    text(row.company_domain, 500);

  const companyWebsite =
    text(row.company_website, 1000);

  const companyLinkedIn =
    text(row.company_linkedin_url, 1000);

  const companyIndustry =
    text(row.company_industry, 300);

  const companyDescription =
    text(row.company_description, 5000);

  const companyFoundedDate =
    dateText(row.company_founded_date);

  const companyRevenueRange =
    text(row.company_revenue_range, 200);

  const companyStaffCountRange =
    text(row.company_staff_count_range, 200);

  const companyStreet =
    text(row.company_street_1, 500);

  const companyCity =
    text(row.company_city, 200);

  const companyState =
    text(row.company_state, 200);

  const companyPostCode =
    text(row.company_post_code, 100);

  const companyCountry =
    text(row.company_country, 200);

  const incomingCompanyFields = {
    canonical_name:
      companyName,
    website:
      companyWebsite,
    industry:
      companyIndustry,
    description:
      companyDescription,
    founded_date:
      companyFoundedDate,
    revenue_range:
      companyRevenueRange,
    staff_count_range:
      companyStaffCountRange,
    street_1:
      companyStreet,
    city:
      companyCity,
    state:
      companyState,
    post_code:
      companyPostCode,
    country:
      companyCountry
  };

  const domainIdentity =
    companyDomain || companyWebsite;

  const hasCompanyData =
    Boolean(
      companyName ||
      domainIdentity ||
      companyLinkedIn
    );

  const identityMatches = [];

  const hasIncomingStrongCompanyIdentity =
    Boolean(
      domainIdentity ||
      companyLinkedIn
    );

  // ----------------------------------------------------------
  // Existing source-record company identity
  //
  // Use only as a fallback when the incoming row does not
  // provide a strong current-company identity. This allows
  // legitimate job changes to a new employer.
  // ----------------------------------------------------------

  if (
    sourceRecordId &&
    !hasIncomingStrongCompanyIdentity
  ) {
    const sourceMatch = await client.query(
      `
        SELECT canonical_company_id
        FROM source_records
        WHERE source_name = $1
          AND source_record_id = $2
        LIMIT 1
      `,
      [sourceName, sourceRecordId]
    );

    if (
      sourceMatch.rowCount > 0 &&
      sourceMatch.rows[0].canonical_company_id
    ) {
      identityMatches.push({
        type: 'source_company',
        company_id:
          sourceMatch.rows[0].canonical_company_id
      });
    }
  }

  // ----------------------------------------------------------
  // Domain identity
  // ----------------------------------------------------------

  if (domainIdentity) {
    const domainMatches = await client.query(
      `
        SELECT id
        FROM companies
        WHERE normalized_domain =
              lumina_normalize_domain($1)
        LIMIT 10
      `,
      [domainIdentity]
    );

    for (const match of domainMatches.rows) {
      identityMatches.push({
        type: 'domain',
        company_id: match.id
      });
    }
  }

  // ----------------------------------------------------------
  // LinkedIn identity
  // ----------------------------------------------------------

  if (companyLinkedIn) {
    const linkedInMatches = await client.query(
      `
        SELECT id
        FROM companies
        WHERE normalized_linkedin_url =
              lumina_normalize_linkedin($1)
        LIMIT 10
      `,
      [companyLinkedIn]
    );

    for (const match of linkedInMatches.rows) {
      identityMatches.push({
        type: 'linkedin',
        company_id: match.id
      });
    }
  }

  const distinctCompanyIds = [
    ...new Set(
      identityMatches.map(
        match => match.company_id
      )
    )
  ];

  // ----------------------------------------------------------
  // Strong company identity disagreement
  // ----------------------------------------------------------

  if (distinctCompanyIds.length > 1) {
    const sourceIdentity =
      identityMatches.find(
        match =>
          match.type === 'source_company'
      );

    const conflictAnchorId =
      sourceIdentity?.company_id ||
      distinctCompanyIds[0];

    const evidence = {
      company_name: companyName,
      company_domain: companyDomain,
      company_website: companyWebsite,
      company_linkedin_url: companyLinkedIn,
      source_name: sourceName,
      source_record_id: sourceRecordId,
      matches: identityMatches,
      candidate_company_ids:
        distinctCompanyIds,
      row_hash: rowHash
    };

    const conflictResult =
      await client.query(
        `
          INSERT INTO conflicts (
            entity_type,
            entity_id,
            field_name,
            existing_value,
            incoming_value,
            source_name,
            source_record_id,
            status,
            import_job_id,
            raw_source_row_id,
            conflict_type,
            candidate_company_ids,
            evidence
          )
          VALUES (
            'company',
            $1,
            'strong_company_identity',
            $2,
            $3,
            $4,
            $5,
            'open',
            $6,
            $7,
            'strong_company_identity_disagreement',
            $8::uuid[],
            $9::jsonb
          )
          RETURNING id
        `,
        [
          conflictAnchorId,
          JSON.stringify(identityMatches),
          JSON.stringify({
            company_name: companyName,
            company_domain: companyDomain,
            company_website: companyWebsite,
            company_linkedin_url:
              companyLinkedIn
          }),
          sourceName,
          sourceRecordId,
          importJobId,
          rawRowId,
          distinctCompanyIds,
          JSON.stringify(evidence)
        ]
      );

    const conflictId =
      conflictResult.rows[0].id;

    await client.query(
      `
        UPDATE raw_source_rows
        SET
          processing_status = 'conflict',
          processing_error =
            'Strong company identity disagreement',
          resolution_method =
            'conflict_strong_company_identity',
          resolution_score = 0,
          resolution_notes = $2::jsonb
        WHERE id = $1
      `,
      [
        rawRowId,
        JSON.stringify({
          conflict_id: conflictId,
          ...evidence
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
          'company.identity_conflict',
          'company',
          $1,
          $2::jsonb
        )
      `,
      [
        conflictAnchorId,
        JSON.stringify({
          conflict_id: conflictId,
          import_job_id: importJobId,
          raw_source_row_id: rawRowId,
          candidate_company_ids:
            distinctCompanyIds,
          evidence
        })
      ]
    );

    return {
      status: 'conflict',
      conflictId,
      candidateCompanyIds:
        distinctCompanyIds
    };
  }

  // ----------------------------------------------------------
  // Existing canonical company
  // ----------------------------------------------------------

  if (distinctCompanyIds.length === 1) {
    const companyId =
      distinctCompanyIds[0];

    let matchType = 'domain';

    if (
      identityMatches.some(
        match =>
          match.type === 'source_company'
      )
    ) {
      matchType = 'source_company';
    } else if (
      identityMatches.some(
        match =>
          match.type === 'linkedin'
      )
    ) {
      matchType = 'linkedin';
    }

    // Lock the canonical Company before evaluating policy.
    const existingCompany =
      await client.query(
        `
          SELECT
            canonical_name,
            website,
            industry,
            description,
            founded_date,
            revenue_range,
            staff_count_range,
            street_1,
            city,
            state,
            post_code,
            country
          FROM companies
          WHERE id = $1
          FOR UPDATE
        `,
        [companyId]
      );

    if (existingCompany.rowCount !== 1) {
      throw new Error(
        `Canonical company not found: ${companyId}`
      );
    }

    const fieldPolicyResolution =
      await evaluateCompanyFieldPolicies(
        client,
        {
          companyId,
          existingValues:
            existingCompany.rows[0],
          incomingValues:
            incomingCompanyFields,
          sourceName,
          sourceRecordId,
          importJobId,
          rawRowId
        }
      );

    const companyUpdate =
      await client.query(
        `
          UPDATE companies
          SET
            canonical_name =
              COALESCE(
                $2,
                canonical_name
              ),
            website =
              COALESCE(
                $3,
                website
              ),
            industry =
              COALESCE(
                $4,
                industry
              ),
            description =
              COALESCE(
                $5,
                description
              ),
            founded_date =
              COALESCE(
                $6::date,
                founded_date
              ),
            revenue_range =
              COALESCE(
                $7,
                revenue_range
              ),
            staff_count_range =
              COALESCE(
                $8,
                staff_count_range
              ),
            street_1 =
              COALESCE(
                $9,
                street_1
              ),
            city =
              COALESCE(
                $10,
                city
              ),
            state =
              COALESCE(
                $11,
                state
              ),
            post_code =
              COALESCE(
                $12,
                post_code
              ),
            country =
              COALESCE(
                $13,
                country
              ),
            updated_at = NOW()
          WHERE id = $1
            AND (
              canonical_name IS DISTINCT FROM
                COALESCE($2, canonical_name)
              OR website IS DISTINCT FROM
                COALESCE($3, website)
              OR industry IS DISTINCT FROM
                COALESCE($4, industry)
              OR description IS DISTINCT FROM
                COALESCE($5, description)
              OR founded_date IS DISTINCT FROM
                COALESCE($6::date, founded_date)
              OR revenue_range IS DISTINCT FROM
                COALESCE($7, revenue_range)
              OR staff_count_range IS DISTINCT FROM
                COALESCE($8, staff_count_range)
              OR street_1 IS DISTINCT FROM
                COALESCE($9, street_1)
              OR city IS DISTINCT FROM
                COALESCE($10, city)
              OR state IS DISTINCT FROM
                COALESCE($11, state)
              OR post_code IS DISTINCT FROM
                COALESCE($12, post_code)
              OR country IS DISTINCT FROM
                COALESCE($13, country)
            )
          RETURNING id
        `,
        [
          companyId,
          fieldPolicyResolution
            .updates.canonical_name ?? null,
          fieldPolicyResolution
            .updates.website ?? null,
          fieldPolicyResolution
            .updates.industry ?? null,
          fieldPolicyResolution
            .updates.description ?? null,
          fieldPolicyResolution
            .updates.founded_date ?? null,
          fieldPolicyResolution
            .updates.revenue_range ?? null,
          fieldPolicyResolution
            .updates.staff_count_range ?? null,
          fieldPolicyResolution
            .updates.street_1 ?? null,
          fieldPolicyResolution
            .updates.city ?? null,
          fieldPolicyResolution
            .updates.state ?? null,
          fieldPolicyResolution
            .updates.post_code ?? null,
          fieldPolicyResolution
            .updates.country ?? null
        ]
      );

    const companyCanonicalChanged =
      companyUpdate.rowCount > 0;

    if (companyCanonicalChanged) {
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
            'company.import_updated',
            'company',
            $1,
            $2::jsonb
          )
        `,
        [
          companyId,
          JSON.stringify({
            import_job_id: importJobId,
            raw_source_row_id: rawRowId,
            source_name: sourceName,
            source_record_id: sourceRecordId,
            match_type: matchType,
            canonical_changed: true,
            field_policy:
              fieldPolicyResolution.summary
          })
        ]
      );
    }

    return {
      status: 'resolved',
      companyId,
      matchType,
      created: false,
      companyCanonicalChanged,
      fieldPolicyResolution
    };
  }

  // ----------------------------------------------------------
  // No company information
  // ----------------------------------------------------------

  if (!hasCompanyData) {
    return {
      status: 'none',
      companyId: null,
      matchType: null,
      created: false
    };
  }

  // ----------------------------------------------------------
  // Create new canonical company
  // ----------------------------------------------------------

  const canonicalName =
    companyName ||
    companyDomain ||
    companyWebsite ||
    companyLinkedIn;

  // For new Companies, canonical_name may fall back to an
  // identity value if a source does not provide company_name.
  incomingCompanyFields.canonical_name =
    canonicalName;

  const created = await client.query(
    `
      INSERT INTO companies (
        canonical_name,
        domain,
        website,
        linkedin_url,
        industry,
        description,
        founded_date,
        revenue_range,
        staff_count_range,
        street_1,
        city,
        state,
        post_code,
        country,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7::date,
        $8,$9,$10,$11,$12,$13,$14,
        $15::jsonb
      )
      RETURNING id
    `,
    [
      canonicalName,
      companyDomain,
      companyWebsite,
      companyLinkedIn,
      companyIndustry,
      companyDescription,
      companyFoundedDate,
      companyRevenueRange,
      companyStaffCountRange,
      companyStreet,
      companyCity,
      companyState,
      companyPostCode,
      companyCountry,
      JSON.stringify({
        source: 'import',
        source_name: sourceName,
        environment: 'staging'
      })
    ]
  );

  const companyId =
    created.rows[0].id;

  // Initialize provenance under the actual creating source.
  const fieldPolicyResolution =
    await evaluateCompanyFieldPolicies(
      client,
      {
        companyId,
        existingValues: {
          canonical_name: null,
          website: null,
          industry: null,
          description: null,
          founded_date: null,
          revenue_range: null,
          staff_count_range: null,
          street_1: null,
          city: null,
          state: null,
          post_code: null,
          country: null
        },
        incomingValues:
          incomingCompanyFields,
        sourceName,
        sourceRecordId,
        importJobId,
        rawRowId
      }
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
        'company.import_created',
        'company',
        $1,
        $2::jsonb
      )
    `,
    [
      companyId,
      JSON.stringify({
        import_job_id: importJobId,
        raw_source_row_id: rawRowId,
        source_name: sourceName,
        source_record_id: sourceRecordId,
        match_type: 'new_company',
        canonical_changed: true,
        field_policy:
          fieldPolicyResolution.summary
      })
    ]
  );

  return {
    status: 'resolved',
    companyId,
    matchType: 'new_company',
    created: true,
    companyCanonicalChanged: true,
    fieldPolicyResolution
  };
}


export async function upsertEmployment(
  client,
  {
    personId,
    companyId,
    row,
    sourceName,
    importJobId
  }
) {
  if (!personId || !companyId) {
    return null;
  }

  const title =
    text(row.current_title, 300);

  const department =
    text(row.department, 150);

  const seniority =
    text(row.seniority, 100);

  // Close any other current employer before assigning
  // the newly imported current company.
  await client.query(
    `
      UPDATE employments
      SET
        is_current = FALSE,
        ended_at = COALESCE(
          ended_at,
          CURRENT_DATE
        ),
        updated_at = NOW()
      WHERE person_id = $1
        AND company_id <> $2
        AND is_current = TRUE
    `,
    [
      personId,
      companyId
    ]
  );

  const result = await client.query(
    `
      INSERT INTO employments (
        person_id,
        company_id,
        title,
        department,
        seniority,
        is_current,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,true,$6::jsonb
      )
      ON CONFLICT (
        person_id,
        company_id
      )
      WHERE is_current = TRUE
      DO UPDATE SET
        title =
          COALESCE(
            EXCLUDED.title,
            employments.title
          ),
        department =
          COALESCE(
            EXCLUDED.department,
            employments.department
          ),
        seniority =
          COALESCE(
            EXCLUDED.seniority,
            employments.seniority
          ),
        metadata =
          employments.metadata ||
          EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id
    `,
    [
      personId,
      companyId,
      title,
      department,
      seniority,
      JSON.stringify({
        source: 'import',
        source_name: sourceName,
        import_job_id: importJobId
      })
    ]
  );

  return result.rows[0].id;
}
