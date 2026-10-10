import {
  getPersonFreshness,
  getPersonEnrichment
} from './living-database-store.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validUuid(value) {
  return (
    typeof value === 'string' &&
    UUID_RE.test(value)
  );
}

function fail(res, status, code) {
  return res.status(status).json({
    status: 'error',
    code
  });
}

export async function getPersonIntelligence(
  client,
  {
    clientId,
    personId
  }
) {
  if (!clientId || !validUuid(personId)) {
    throw new Error(
      'INVALID_PERSON_INTELLIGENCE_SCOPE'
    );
  }

  const personResult = await client.query(
    `
      SELECT
        p.id,
        p.full_name,
        p.first_name,
        p.last_name,
        p.current_title,
        p.department,
        p.seniority,
        p.contact_city,
        p.contact_country,
        p.linkedin_url,
        p.created_at,
        p.updated_at,

        pe.email AS primary_email,
        pe.validation_status
          AS email_validation_status,

        pp.phone_number AS primary_phone,
        pp.phone_type AS primary_phone_type,

        emp.employment_id,
        emp.company_id,
        emp.employment_title,
        emp.employment_department,
        emp.employment_seniority,

        emp.company_name,
        emp.company_domain,
        emp.company_website,
        emp.company_linkedin_url,
        emp.company_industry,
        emp.company_description,
        emp.company_founded_date,
        emp.company_revenue_range,
        emp.company_staff_count_range,
        emp.company_street_1,
        emp.company_city,
        emp.company_state,
        emp.company_post_code,
        emp.company_country,

        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'name', i.name
              )
              ORDER BY i.name
            )
            FROM person_icp_tags pit
            JOIN icp_definitions i
              ON i.id = pit.icp_id
             AND i.client_id = pit.client_id
            WHERE pit.person_id = p.id
              AND pit.client_id = $2
          ),
          '[]'::jsonb
        ) AS icp_tags

      FROM persons p

      LEFT JOIN LATERAL (
        SELECT
          e.id AS employment_id,
          e.company_id,
          e.title AS employment_title,
          e.department
            AS employment_department,
          e.seniority
            AS employment_seniority,

          c.canonical_name
            AS company_name,
          c.domain
            AS company_domain,
          c.website
            AS company_website,
          c.linkedin_url
            AS company_linkedin_url,
          c.industry
            AS company_industry,
          c.description
            AS company_description,
          c.founded_date
            AS company_founded_date,
          c.revenue_range
            AS company_revenue_range,
          c.staff_count_range
            AS company_staff_count_range,
          c.street_1
            AS company_street_1,
          c.city
            AS company_city,
          c.state
            AS company_state,
          c.post_code
            AS company_post_code,
          c.country
            AS company_country

        FROM employments e
        JOIN companies c
          ON c.id = e.company_id
        WHERE e.person_id = p.id
          AND e.is_current = TRUE
          AND c.status = 'active'
        ORDER BY
          e.updated_at DESC,
          e.created_at DESC
        LIMIT 1
      ) emp ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          email,
          validation_status
        FROM emails
        WHERE person_id = p.id
        ORDER BY
          is_primary DESC,
          created_at,
          id
        LIMIT 1
      ) pe ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          phone_number,
          phone_type
        FROM phones
        WHERE person_id = p.id
        ORDER BY
          is_primary DESC,
          created_at,
          id
        LIMIT 1
      ) pp ON TRUE

      WHERE p.id = $1
        AND p.status = 'active'
      LIMIT 1
    `,
    [
      personId,
      clientId
    ]
  );

  if (personResult.rowCount !== 1) {
    return null;
  }

  const row = personResult.rows[0];

  const employmentResult =
    await client.query(
      `
        SELECT
          e.id,
          e.company_id,
          c.canonical_name AS company_name,
          e.title,
          e.department,
          e.seniority,
          e.is_current,
          e.started_at,
          e.ended_at,
          e.created_at,
          e.updated_at
        FROM employments e
        JOIN companies c
          ON c.id = e.company_id
        WHERE e.person_id = $1
        ORDER BY
          e.is_current DESC,
          e.ended_at DESC NULLS FIRST,
          e.updated_at DESC,
          e.id
        LIMIT 100
      `,
      [personId]
    );

  const campaignResult =
    await client.query(
      `
        SELECT
          c.id AS campaign_id,
          c.name AS campaign_name,
          c.status AS campaign_status,
          cp.stage,
          cp.status AS participation_status,
          cp.first_contacted_at,
          cp.last_contacted_at,
          cp.note,
          cp.created_at,
          cp.updated_at
        FROM campaign_participations cp
        JOIN campaigns c
          ON c.id = cp.campaign_id
        WHERE cp.person_id = $1
          AND c.client_id = $2
        ORDER BY
          cp.updated_at DESC,
          c.name
      `,
      [
        personId,
        clientId
      ]
    );

  const campaignEvents =
    await client.query(
      `
        SELECT
          e.id,
          e.campaign_id,
          c.name AS campaign_name,
          e.actor,
          e.action,
          e.details,
          e.created_at
        FROM campaign_history_events e
        JOIN campaigns c
          ON c.id = e.campaign_id
        WHERE e.person_id = $1
          AND e.client_id = $2
          AND c.client_id = $2
        ORDER BY
          e.created_at DESC,
          e.id
        LIMIT 100
      `,
      [
        personId,
        clientId
      ]
    );

  const [
    freshness,
    enrichment
  ] = await Promise.all([
    getPersonFreshness(
      client,
      {
        clientId,
        personId
      }
    ),
    getPersonEnrichment(
      client,
      {
        clientId,
        personId
      }
    )
  ]);

  return {
    person: {
      id: row.id,
      full_name: row.full_name,
      first_name: row.first_name,
      last_name: row.last_name,
      current_title: row.current_title,
      department: row.department,
      seniority: row.seniority,
      contact_city: row.contact_city,
      contact_country: row.contact_country,
      linkedin_url: row.linkedin_url,
      created_at: row.created_at,
      updated_at: row.updated_at
    },

    contact: {
      primary_email: row.primary_email,
      email_validation_status:
        row.email_validation_status,
      primary_phone: row.primary_phone,
      primary_phone_type:
        row.primary_phone_type
    },

    company: row.company_id
      ? {
          id: row.company_id,
          name: row.company_name,
          domain: row.company_domain,
          website: row.company_website,
          linkedin_url:
            row.company_linkedin_url,
          industry: row.company_industry,
          description:
            row.company_description,
          founded_date:
            row.company_founded_date,
          revenue_range:
            row.company_revenue_range,
          staff_count_range:
            row.company_staff_count_range,
          street_1:
            row.company_street_1,
          city: row.company_city,
          state: row.company_state,
          post_code: row.company_post_code,
          country: row.company_country
        }
      : null,

    current_employment:
      row.employment_id
        ? {
            id: row.employment_id,
            company_id: row.company_id,
            title:
              row.employment_title,
            department:
              row.employment_department,
            seniority:
              row.employment_seniority
          }
        : null,

    employment_history:
      employmentResult.rows,

    icp_tags:
      Array.isArray(row.icp_tags)
        ? row.icp_tags
        : [],

    freshness,

    enrichment,

    campaigns:
      campaignResult.rows,

    campaign_events:
      campaignEvents.rows
  };
}

export function registerLivingDatabaseRoutes(
  app,
  pool
) {
  app.get(
    '/api/v1/people/:id/intelligence',
    async (req, res) => {
      if (
        !req.auth?.clientId ||
        !req.auth?.principalId
      ) {
        return fail(
          res,
          401,
          'AUTHENTICATION_REQUIRED'
        );
      }

      if (!validUuid(req.params.id)) {
        return fail(
          res,
          400,
          'INVALID_PERSON_ID'
        );
      }

      const client =
        await pool.connect();

      try {
        const data =
          await getPersonIntelligence(
            client,
            {
              clientId:
                req.auth.clientId,
              personId:
                req.params.id
            }
          );

        if (!data) {
          return fail(
            res,
            404,
            'PERSON_NOT_FOUND'
          );
        }

        res.set(
          'Cache-Control',
          'no-store'
        );

        return res.json({
          status: 'ok',
          data
        });
      } catch (error) {
        console.error(
          'Person intelligence request failed:',
          error
        );

        return fail(
          res,
          500,
          'PERSON_INTELLIGENCE_FAILED'
        );
      } finally {
        client.release();
      }
    }
  );
}
