import ExcelJS from 'exceljs';

const SEARCH_LIMIT_MAX = 100;
const FREEZE_MAX_ROWS = 25000;
const EXPORT_MAX_ROWS = 25000;

const STANDARD_EXPORT_HEADERS = [
  'Contact Full Name',
  'First Name',
  'Last Name',
  'Title',
  'Department',
  'Seniority',
  'Company Name - Cleaned',
  'Website',
  'List',
  'Contact LI Profile URL',
  'Email 1',
  'Email 1 Validation',
  'ContactPhone1',
  'CompanyPhone1',
  'ContactPhone2',
  'Contact City',
  'Contact Country',
  'Company Street 1',
  'Company City',
  'Company State',
  'Company Post Code',
  'Company Country',
  'Company Description',
  'Company Founded Date',
  'Company Industry',
  'Company LI Profile Url',
  'Company Revenue Range',
  'Company Staff Count Range',
  'Stage',
  'Note'
];

const FIELD_ALIASES = {
  icp: [],
  title: ['title', 'jobtitle', 'job_title', 'role', 'position'],
  department: ['department', 'dept', 'function'],
  seniority: ['seniority', 'level', 'seniorlevel', 'senior_level'],
  location: ['location', 'loc', 'place'],
  city: ['city', 'contactcity', 'contact_city'],
  country: ['country', 'contactcountry', 'contact_country'],
  company: ['company', 'companyname', 'company_name', 'organisation', 'organization'],
  industry: ['industry', 'sector', 'vertical'],
  domain: ['domain', 'companydomain', 'company_domain', 'website'],
  email: ['email', 'workemail', 'work_email']
};

function cleanText(value, max = 1000) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const x = normalizeKey(a);
  const y = normalizeKey(b);
  const dp = Array.from({ length: x.length + 1 }, () =>
    Array(y.length + 1).fill(0)
  );
  for (let i = 0; i <= x.length; i++) dp[i][0] = i;
  for (let j = 0; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );

      // Treat an adjacent character transposition as one edit.
      // Example: "titel" -> "title".
      if (
        i > 1 &&
        j > 1 &&
        x[i - 1] === y[j - 2] &&
        x[i - 2] === y[j - 1]
      ) {
        dp[i][j] = Math.min(
          dp[i][j],
          dp[i - 2][j - 2] + 1
        );
      }
    }
  }
  return dp[x.length][y.length];
}

function canonicalField(rawKey) {
  const key = normalizeKey(rawKey);
  if (!key) return null;

  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const candidates = [canonical, ...aliases];
    if (candidates.some(candidate => normalizeKey(candidate) === key)) {
      return canonical;
    }
  }

  let best = null;
  let bestDistance = Infinity;

  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const candidate of [canonical, ...aliases]) {
      const distance = levenshtein(key, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = canonical;
      }
    }
  }

  const tolerance = key.length <= 5 ? 1 : 2;
  return bestDistance <= tolerance ? best : null;
}

function normalizeFilters(input = {}) {
  const filters = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return filters;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const field = canonicalField(rawKey);
    const value = cleanText(rawValue, 500);
    if (field && value) filters[field] = value;
  }

  return filters;
}

function interpretInput(rawInput, directFilters = {}) {
  const original = cleanText(rawInput, 3000) || '';
  const filters = normalizeFilters(directFilters);
  const freeText = [];

  // Recognize an unambiguous, standalone country query.
  const standaloneSingapore = /^singapore$/i.test(original.trim())
    && !Object.prototype.hasOwnProperty.call(filters, 'country');
  if (standaloneSingapore) filters.country = 'Singapore';

  // Treat a standalone email address as an exact identity filter,
  // not generic fuzzy free text.
  const standaloneEmail =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(original.trim())
    && !Object.prototype.hasOwnProperty.call(filters, 'email');

  if (standaloneEmail) {
    filters.email = original.trim();
  }

  const chunks = (
    standaloneSingapore || standaloneEmail
      ? ''
      : original
  )
    .split(/[\n;,]+|\s+and\s+/i)
    .map(v => v.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const explicit = chunk.match(/^\s*([^:=]{2,40})\s*[:=]\s*(.+?)\s*$/);
    if (explicit) {
      const field = canonicalField(explicit[1]);
      const value = cleanText(explicit[2], 500);
      if (field && value) {
        filters[field] = value;
        continue;
      }
    }

    const prefix = chunk.match(/^\s*([a-zA-Z_\- ]{2,30})\s+(.+?)\s*$/);
    if (prefix) {
      const field = canonicalField(prefix[1]);
      const value = cleanText(prefix[2], 500);
      if (field && value) {
        filters[field] = value;
        continue;
      }
    }

    freeText.push(chunk);
  }

  const q = cleanText(freeText.join(' '), 1000);
  const parts = [];
  if (q) parts.push(`Search: ${q}`);
  for (const [field, value] of Object.entries(filters)) {
    parts.push(`${field}: ${value}`);
  }

  return {
    original_input: original || null,
    q,
    filters,
    understood_as: parts.length ? parts.join(' | ') : 'No search terms detected',
    interpreter_version: 'r17-deterministic-v2'
  };
}

async function resolveSingleActiveClient_DEPRECATED(client) {
  const result = await client.query(`
    SELECT id
    FROM clients
    WHERE status = 'active'
    ORDER BY created_at, id
    LIMIT 2
  `);

  if (result.rowCount === 0) {
    const error = new Error('CLIENT_CONTEXT_UNAVAILABLE');
    error.code = 'CLIENT_CONTEXT_UNAVAILABLE';
    throw error;
  }

  if (result.rowCount > 1) {
    const error = new Error('CLIENT_AUTHORIZATION_REQUIRED');
    error.code = 'CLIENT_AUTHORIZATION_REQUIRED';
    throw error;
  }

  return result.rows[0].id;
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function buildPeopleSearch({ clientId, q = null, filters = {}, limit = 25, offset = 0, idsOnly = false, maxRows = null }) {
  if (!isUuid(clientId)) throw new Error('Client context required for search');
  const params = [];
  const clientParam = addParam(params, clientId);
  const where = [`p.status = 'active'`, `${clientParam}::uuid IS NOT NULL`];

  function fuzzy(column, value, threshold = 0.45) {
    const p = addParam(params, value);
    where.push(`(
      ${column} ILIKE '%' || ${p} || '%'
      OR similarity(COALESCE(${column}, ''), ${p}) >= ${threshold}
    )`);
  }

  if (filters.icp) {
    const tagParam = addParam(params, filters.icp);
    where.push(`EXISTS (SELECT 1 FROM person_icp_tags it WHERE it.person_id=p.id AND it.client_id=${clientParam} AND it.icp_id=${tagParam}::uuid)`);
  }

  if (q) {
    const p = addParam(params, q);
    where.push(`(
      p.full_name ILIKE '%' || ${p} || '%'
      OR p.current_title ILIKE '%' || ${p} || '%'
      OR COALESCE(emp.company_name, '') ILIKE '%' || ${p} || '%'
      OR COALESCE(pe.email::text, '') ILIKE '%' || ${p} || '%'
      OR similarity(COALESCE(p.full_name, ''), ${p}) >= 0.35
      OR similarity(COALESCE(p.current_title, ''), ${p}) >= 0.35
      OR similarity(COALESCE(emp.company_name, ''), ${p}) >= 0.35
    )`);
  }

  if (filters.title) fuzzy('p.current_title', filters.title, 0.4);
  if (filters.department) fuzzy('p.department', filters.department, 0.5);
  if (filters.seniority) fuzzy('p.seniority', filters.seniority, 0.5);
  if (filters.company) fuzzy('emp.company_name', filters.company, 0.4);
  if (filters.industry) fuzzy('emp.company_industry', filters.industry, 0.5);

  if (filters.city) fuzzy('p.contact_city', filters.city, 0.5);
  if (filters.country) fuzzy('p.contact_country', filters.country, 0.5);

  if (filters.location) {
    const p = addParam(params, filters.location);
    where.push(`(
      p.contact_city ILIKE '%' || ${p} || '%'
      OR p.contact_country ILIKE '%' || ${p} || '%'
      OR COALESCE(emp.company_city, '') ILIKE '%' || ${p} || '%'
      OR COALESCE(emp.company_country, '') ILIKE '%' || ${p} || '%'
      OR similarity(COALESCE(p.contact_city, ''), ${p}) >= 0.5
      OR similarity(COALESCE(p.contact_country, ''), ${p}) >= 0.5
      OR similarity(COALESCE(emp.company_city, ''), ${p}) >= 0.5
      OR similarity(COALESCE(emp.company_country, ''), ${p}) >= 0.5
    )`);
  }

  if (filters.domain) {
    const p = addParam(params, filters.domain);
    where.push(`(
      COALESCE(emp.company_domain::text, '') ILIKE '%' || ${p} || '%'
      OR COALESCE(emp.company_website, '') ILIKE '%' || ${p} || '%'
    )`);
  }

  if (filters.email) {
    const p = addParam(params, filters.email);
    where.push(`EXISTS (
      SELECT 1
      FROM emails em_filter
      WHERE em_filter.person_id = p.id
        AND em_filter.normalized_email = lumina_normalize_email(${p})
    )`);
  }

  const baseFrom = `
    FROM persons p
    LEFT JOIN LATERAL (
      SELECT
        e.company_id,
        e.title AS employment_title,
        e.department AS employment_department,
        e.seniority AS employment_seniority,
        c.canonical_name AS company_name,
        c.domain AS company_domain,
        c.website AS company_website,
        c.linkedin_url AS company_linkedin_url,
        c.industry AS company_industry,
        c.description AS company_description,
        c.founded_date AS company_founded_date,
        c.revenue_range AS company_revenue_range,
        c.staff_count_range AS company_staff_count_range,
        c.street_1 AS company_street_1,
        c.city AS company_city,
        c.state AS company_state,
        c.post_code AS company_post_code,
        c.country AS company_country
      FROM employments e
      JOIN companies c ON c.id = e.company_id
      WHERE e.person_id = p.id
        AND e.is_current = true
        AND c.status = 'active'
      ORDER BY e.updated_at DESC, e.created_at DESC
      LIMIT 1
    ) emp ON true
    LEFT JOIN LATERAL (
      SELECT email, validation_status
      FROM emails em
      WHERE em.person_id = p.id
      ORDER BY em.is_primary DESC, em.created_at, em.id
      LIMIT 1
    ) pe ON true
    LEFT JOIN LATERAL (
      SELECT phone_number, phone_type
      FROM phones ph
      WHERE ph.person_id = p.id
      ORDER BY ph.is_primary DESC, ph.created_at, ph.id
      LIMIT 1
    ) pp ON true
  `;

  if (idsOnly) {
    const cap = maxRows || FREEZE_MAX_ROWS;
    const limitParam = addParam(params, cap + 1);
    return {
      sql: `
        SELECT p.id
        ${baseFrom}
        WHERE ${where.join('\n AND ')}
        ORDER BY p.id
        LIMIT ${limitParam}
      `,
      params
    };
  }

  const limitParam = addParam(params, Math.min(limit, SEARCH_LIMIT_MAX));
  const offsetParam = addParam(params, offset);

  return {
    sql: `
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
        pe.email AS primary_email,
        pe.validation_status AS email_validation_status,
        pp.phone_number AS primary_phone,
        pp.phone_type AS primary_phone_type,
        emp.company_id,
        emp.company_name,
        emp.company_domain,
        emp.company_website,
        emp.company_linkedin_url,
        emp.company_industry,
        emp.company_city,
        emp.company_country,
        p.created_at,
        p.updated_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name) ORDER BY i.name)
          FROM person_icp_tags t JOIN icp_definitions i ON i.id=t.icp_id AND i.client_id=t.client_id
          WHERE t.person_id=p.id AND t.client_id=${clientParam}), '[]'::jsonb) AS icp_tags
      ${baseFrom}
      WHERE ${where.join('\n AND ')}
      ORDER BY p.updated_at DESC, p.id
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    params
  };
}

async function insertAudit(client, { action, entityType, entityId, clientId = null, details = {}, actor = 'lumina-bridge' }) {
  await client.query(
    `
      INSERT INTO audit_events (
        actor, action, entity_type, entity_id, client_id, details
      )
      VALUES ($6, $1, $2, $3, $4, $5::jsonb)
    `,
    [action, entityType, entityId, clientId, JSON.stringify(details), actor]
  );
}

function handleProductError(res, error, fallbackCode) {
  const known = new Set([
    'CLIENT_CONTEXT_UNAVAILABLE',
    'CLIENT_AUTHORIZATION_REQUIRED'
  ]);

  if (known.has(error?.code)) {
    return res.status(503).json({ status: 'error', code: error.code });
  }

  console.error(`${fallbackCode}:`, error);
  return res.status(500).json({ status: 'error', code: fallbackCode });
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rowToExportValues(row) {
  return [
    row.contact_full_name,
    row.first_name,
    row.last_name,
    row.title,
    row.department,
    row.seniority,
    row.company_name_cleaned,
    row.website,
    row.list_name,
    row.contact_li_profile_url,
    row.email_1,
    row.email_1_validation,
    row.contact_phone_1,
    row.company_phone_1,
    row.contact_phone_2,
    row.contact_city,
    row.contact_country,
    row.company_street_1,
    row.company_city,
    row.company_state,
    row.company_post_code,
    row.company_country,
    row.company_description,
    row.company_founded_date,
    row.company_industry,
    row.company_li_profile_url,
    row.company_revenue_range,
    row.company_staff_count_range,
    row.stage,
    row.note
  ];
}

async function fetchExportRows(client, { listId, campaignId = null }) {
  const result = await client.query(
    `
      SELECT
        p.full_name AS contact_full_name,
        p.first_name,
        p.last_name,
        p.current_title AS title,
        p.department,
        p.seniority,
        emp.company_name AS company_name_cleaned,
        emp.company_website AS website,
        l.name AS list_name,
        p.linkedin_url AS contact_li_profile_url,
        pe.email AS email_1,
        pe.validation_status AS email_1_validation,
        pp1.phone_number AS contact_phone_1,
        cp1.phone_number AS company_phone_1,
        pp2.phone_number AS contact_phone_2,
        p.contact_city,
        p.contact_country,
        emp.company_street_1,
        emp.company_city,
        emp.company_state,
        emp.company_post_code,
        emp.company_country,
        emp.company_description,
        to_char(emp.company_founded_date, 'YYYY-MM-DD') AS company_founded_date,
        emp.company_industry,
        emp.company_linkedin_url AS company_li_profile_url,
        emp.company_revenue_range,
        emp.company_staff_count_range,
        cpart.stage,
        cpart.note
      FROM list_memberships lm
      JOIN lists l ON l.id = lm.list_id
      JOIN persons p ON p.id = lm.person_id
      LEFT JOIN LATERAL (
        SELECT
          e.company_id,
          c.canonical_name AS company_name,
          c.website AS company_website,
          c.linkedin_url AS company_linkedin_url,
          c.industry AS company_industry,
          c.description AS company_description,
          c.founded_date AS company_founded_date,
          c.revenue_range AS company_revenue_range,
          c.staff_count_range AS company_staff_count_range,
          c.street_1 AS company_street_1,
          c.city AS company_city,
          c.state AS company_state,
          c.post_code AS company_post_code,
          c.country AS company_country
        FROM employments e
        JOIN companies c ON c.id = e.company_id
        WHERE e.person_id = p.id
          AND e.is_current = true
        ORDER BY e.updated_at DESC, e.created_at DESC
        LIMIT 1
      ) emp ON true
      LEFT JOIN LATERAL (
        SELECT email, validation_status
        FROM emails em
        WHERE em.person_id = p.id
        ORDER BY em.is_primary DESC, em.created_at, em.id
        LIMIT 1
      ) pe ON true
      LEFT JOIN LATERAL (
        SELECT phone_number
        FROM phones ph
        WHERE ph.person_id = p.id
        ORDER BY ph.is_primary DESC, ph.created_at, ph.id
        LIMIT 1
      ) pp1 ON true
      LEFT JOIN LATERAL (
        SELECT phone_number
        FROM phones ph
        WHERE ph.person_id = p.id
        ORDER BY ph.is_primary DESC, ph.created_at, ph.id
        OFFSET 1
        LIMIT 1
      ) pp2 ON true
      LEFT JOIN LATERAL (
        SELECT phone_number
        FROM phones ph
        WHERE ph.company_id = emp.company_id
        ORDER BY ph.is_primary DESC, ph.created_at, ph.id
        LIMIT 1
      ) cp1 ON true
      LEFT JOIN campaign_participations cpart
        ON cpart.person_id = p.id
       AND cpart.campaign_id = $2
      WHERE lm.list_id = $1
      ORDER BY p.full_name NULLS LAST, p.id
      LIMIT $3
    `,
    [listId, campaignId, EXPORT_MAX_ROWS + 1]
  );

  if (result.rowCount > EXPORT_MAX_ROWS) {
    const error = new Error('EXPORT_ASYNC_REQUIRED');
    error.code = 'EXPORT_ASYNC_REQUIRED';
    throw error;
  }

  return result.rows;
}

export function registerProductRoutes(app, pool) {
  app.post('/api/v1/search/interpret', async (req, res) => {
    const interpreted = interpretInput(req.body?.input, req.body?.filters);
    if (interpreted.filters.icp && !isUuid(interpreted.filters.icp)) return res.status(400).json({status:'error',code:'INVALID_ICP_FILTER'});
    res.json({ status: 'ok', data: interpreted });
  });

  app.post('/api/v1/search/people', async (req, res) => {
    try {
      const interpreted = interpretInput(req.body?.input, req.body?.filters);
    if (interpreted.filters.icp && !isUuid(interpreted.filters.icp)) return res.status(400).json({status:'error',code:'INVALID_ICP_FILTER'});
      const q = cleanText(req.body?.q, 1000) || interpreted.q;
      const limit = boundedInt(req.body?.limit, 25, 1, SEARCH_LIMIT_MAX);
      const offset = boundedInt(req.body?.offset, 0, 0, 1000000);
      const query = buildPeopleSearch({ clientId: req.auth.clientId, q, filters: interpreted.filters, limit, offset });
      const result = await pool.query(query.sql, query.params);

      res.set('Cache-Control', 'no-store');
      res.json({
        status: 'ok',
        understood_as: interpreted.understood_as,
        interpreted_query: { q, filters: interpreted.filters },
        pagination: { limit, offset },
        count: result.rowCount,
        data: result.rows
      });
    } catch (error) {
      handleProductError(res, error, 'PEOPLE_SEARCH_FAILED');
    }
  });

  app.get('/api/v1/saved-targets', async (req, res) => {
    const client = await pool.connect();
    try {
      const clientId = req.auth.clientId;
      const result = await client.query(
        `SELECT * FROM saved_targets WHERE client_id = $1 ORDER BY updated_at DESC, id`,
        [clientId]
      );
      res.json({ status: 'ok', data: result.rows });
    } catch (error) {
      handleProductError(res, error, 'SAVED_TARGET_LIST_FAILED');
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/saved-targets', async (req, res) => {
    const name = cleanText(req.body?.name, 300);
    if (!name) return res.status(400).json({ status: 'error', code: 'NAME_REQUIRED' });

    const interpreted = req.body?.interpreted_query && typeof req.body.interpreted_query === 'object'
      ? req.body.interpreted_query
      : interpretInput(req.body?.original_input, req.body?.filters);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = req.auth.clientId;
      const result = await client.query(
        `
          INSERT INTO saved_targets (
            client_id, name, original_input, interpreted_query, created_by, metadata
          )
          VALUES ($1, $2, $3, $4::jsonb, 'lumina-bridge', $5::jsonb)
          RETURNING *
        `,
        [
          clientId,
          name,
          cleanText(req.body?.original_input, 3000),
          JSON.stringify(interpreted),
          JSON.stringify({ interpreter_version: 'r17-deterministic-v2' })
        ]
      );
      await insertAudit(client, {
        action: 'saved_target.created',
        entityType: 'saved_target',
        entityId: result.rows[0].id,
        clientId,
        details: { name }
      });
      await client.query('COMMIT');
      res.status(201).json({ status: 'ok', data: result.rows[0] });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}

      if (
        error?.code === '23505' &&
        error?.constraint === 'uq_saved_targets_client_normalized_name'
      ) {
        return res.status(409).json({
          status: 'error',
          code: 'SAVED_TARGET_NAME_EXISTS',
          message: 'A saved search with this name already exists.'
        });
      }

      handleProductError(res, error, 'SAVED_TARGET_CREATE_FAILED');
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/lists', async (req, res) => {
    const client = await pool.connect();
    try {
      const clientId = req.auth.clientId;
      const result = await client.query(
        `
          SELECT
            l.*,
            COUNT(lm.person_id)::integer AS member_count
          FROM lists l
          LEFT JOIN list_memberships lm ON lm.list_id = l.id
          WHERE l.client_id = $1
          GROUP BY l.id
          ORDER BY l.updated_at DESC, l.id
        `,
        [clientId]
      );
      res.json({ status: 'ok', data: result.rows });
    } catch (error) {
      handleProductError(res, error, 'LIST_QUERY_FAILED');
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/lists', async (req, res) => {
    const name = cleanText(req.body?.name, 300);
    if (!name) return res.status(400).json({ status: 'error', code: 'NAME_REQUIRED' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = req.auth.clientId;
      const result = await client.query(
        `
          INSERT INTO lists (client_id, name, description, list_type, created_by, metadata)
          VALUES ($1, $2, $3, 'static', 'lumina-bridge', '{}'::jsonb)
          RETURNING *
        `,
        [clientId, name, cleanText(req.body?.description, 2000)]
      );
      await insertAudit(client, {
        action: 'list.created',
        entityType: 'list',
        entityId: result.rows[0].id,
        clientId,
        details: { name }
      });
      await client.query('COMMIT');
      res.status(201).json({ status: 'ok', data: result.rows[0] });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      handleProductError(res, error, 'LIST_CREATE_FAILED');
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/lists/from-target', async (req, res) => {
    const targetId = cleanText(req.body?.target_id, 100);
    const name = cleanText(req.body?.name, 300);
    if (!isUuid(targetId)) return res.status(400).json({ status: 'error', code: 'INVALID_TARGET_ID' });
    if (!name) return res.status(400).json({ status: 'error', code: 'NAME_REQUIRED' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = req.auth.clientId;
      const targetResult = await client.query(
        `SELECT * FROM saved_targets WHERE id = $1 AND client_id = $2 FOR SHARE`,
        [targetId, clientId]
      );
      if (targetResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        return res.status(404).json({ status: 'error', code: 'SAVED_TARGET_NOT_FOUND' });
      }

      const target = targetResult.rows[0];
      const iq = target.interpreted_query || {};
      const q = cleanText(iq.q, 1000);
      const filters = normalizeFilters(iq.filters || iq);
      const search = buildPeopleSearch({ clientId, q, filters, idsOnly: true, maxRows: FREEZE_MAX_ROWS });
      const people = await client.query(search.sql, search.params);

      if (people.rowCount > FREEZE_MAX_ROWS) {
        await client.query('ROLLBACK');
        return res.status(413).json({
          status: 'error',
          code: 'LIST_FREEZE_TOO_LARGE',
          max_rows: FREEZE_MAX_ROWS
        });
      }

      const listResult = await client.query(
        `
          INSERT INTO lists (
            client_id, name, description, list_type, created_by, metadata, source_target_id
          )
          VALUES ($1, $2, $3, 'static', 'lumina-bridge', $4::jsonb, $5)
          RETURNING *
        `,
        [
          clientId,
          name,
          cleanText(req.body?.description, 2000),
          JSON.stringify({ frozen_from_target: true, target_name: target.name }),
          targetId
        ]
      );

      const listId = listResult.rows[0].id;
      if (people.rowCount > 0) {
        const ids = people.rows.map(row => row.id);
        await client.query(
          `
            INSERT INTO list_memberships (list_id, person_id, added_by, metadata)
            SELECT $1, id, 'lumina-bridge', '{"source":"saved_target_freeze"}'::jsonb
            FROM unnest($2::uuid[]) AS id
            ON CONFLICT (list_id, person_id) DO NOTHING
          `,
          [listId, ids]
        );
      }

      await insertAudit(client, {
        action: 'list.frozen_from_target',
        entityType: 'list',
        entityId: listId,
        clientId,
        details: { target_id: targetId, member_count: people.rowCount }
      });
      await client.query('COMMIT');

      res.status(201).json({
        status: 'ok',
        data: listResult.rows[0],
        member_count: people.rowCount
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      handleProductError(res, error, 'LIST_FREEZE_FAILED');
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/lists/:id/members', async (req, res) => {
    const listId = cleanText(req.params?.id, 100);
    const personIds = Array.isArray(req.body?.person_ids)
      ? [...new Set(req.body.person_ids.filter(isUuid))].slice(0, 1000)
      : [];

    if (!isUuid(listId)) return res.status(400).json({ status: 'error', code: 'INVALID_LIST_ID' });
    if (personIds.length === 0) return res.status(400).json({ status: 'error', code: 'PERSON_IDS_REQUIRED' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = req.auth.clientId;
      const listResult = await client.query(
        `SELECT id FROM lists WHERE id = $1 AND client_id = $2 FOR SHARE`,
        [listId, clientId]
      );
      if (listResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        return res.status(404).json({ status: 'error', code: 'LIST_NOT_FOUND' });
      }

      const result = await client.query(
        `
          INSERT INTO list_memberships (list_id, person_id, added_by, metadata)
          SELECT $1, p.id, 'lumina-bridge', '{"source":"manual_add"}'::jsonb
          FROM persons p
          WHERE p.id = ANY($2::uuid[])
          ON CONFLICT (list_id, person_id) DO NOTHING
          RETURNING person_id
        `,
        [listId, personIds]
      );

      await client.query(`UPDATE lists SET updated_at = NOW() WHERE id = $1`, [listId]);
      await insertAudit(client, {
        action: 'list.members_added',
        entityType: 'list',
        entityId: listId,
        clientId,
        details: { requested: personIds.length, added: result.rowCount }
      });
      await client.query('COMMIT');
      res.json({ status: 'ok', requested: personIds.length, added: result.rowCount });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      handleProductError(res, error, 'LIST_MEMBER_ADD_FAILED');
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/lists/:id/members', async (req, res) => {
    const listId = cleanText(req.params?.id, 100);
    if (!isUuid(listId)) return res.status(400).json({ status: 'error', code: 'INVALID_LIST_ID' });

    const limit = boundedInt(req.query?.limit, 50, 1, SEARCH_LIMIT_MAX);
    const offset = boundedInt(req.query?.offset, 0, 0, 1000000);
    const client = await pool.connect();
    try {
      const clientId = req.auth.clientId;
      const ownedList = await client.query(
        'SELECT id FROM lists WHERE id = $1 AND client_id = $2',
        [listId, clientId]
      );
      if (ownedList.rowCount === 0) {
        return res.status(404).json({
          status: 'error',
          code: 'LIST_NOT_FOUND'
        });
      }

      const result = await client.query(
        `
          SELECT
            p.id,
            p.full_name,
            p.current_title,
            p.department,
            p.seniority,
            p.contact_city,
            p.contact_country,
            p.linkedin_url,
            lm.added_at,
            lm.added_by
          FROM lists l
          JOIN list_memberships lm ON lm.list_id = l.id
          JOIN persons p ON p.id = lm.person_id
          WHERE l.id = $1
            AND l.client_id = $2
          ORDER BY lm.added_at DESC, p.id
          LIMIT $3 OFFSET $4
        `,
        [listId, clientId, limit, offset]
      );
      res.json({ status: 'ok', count: result.rowCount, pagination: { limit, offset }, data: result.rows });
    } catch (error) {
      handleProductError(res, error, 'LIST_MEMBER_QUERY_FAILED');
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/exports', async (req, res) => {
    const client = await pool.connect();
    try {
      const clientId = req.auth.clientId;
      const result = await client.query(
        `
          SELECT
            e.*,
            l.name AS list_name,
            c.name AS campaign_name
          FROM export_jobs e
          LEFT JOIN lists l ON l.id = e.list_id
          LEFT JOIN campaigns c ON c.id = e.campaign_id
          WHERE e.client_id = $1
          ORDER BY e.created_at DESC, e.id
        `,
        [clientId]
      );
      res.json({ status: 'ok', data: result.rows });
    } catch (error) {
      handleProductError(res, error, 'EXPORT_HISTORY_FAILED');
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/exports', async (req, res) => {
    const listId = cleanText(req.body?.list_id, 100);
    const campaignId = cleanText(req.body?.campaign_id, 100);
    const format = (cleanText(req.body?.format, 20) || 'csv').toLowerCase();

    if (!isUuid(listId)) return res.status(400).json({ status: 'error', code: 'INVALID_LIST_ID' });
    if (campaignId && !isUuid(campaignId)) return res.status(400).json({ status: 'error', code: 'INVALID_CAMPAIGN_ID' });
    if (!['csv', 'xlsx'].includes(format)) return res.status(400).json({ status: 'error', code: 'UNSUPPORTED_EXPORT_FORMAT' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = req.auth.clientId;
      const listResult = await client.query(
        `SELECT id, name FROM lists WHERE id = $1 AND client_id = $2 FOR SHARE`,
        [listId, clientId]
      );
      if (listResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        return res.status(404).json({ status: 'error', code: 'LIST_NOT_FOUND' });
      }

      if (campaignId) {
        const campaignResult = await client.query(
          `SELECT id FROM campaigns WHERE id = $1 AND client_id = $2`,
          [campaignId, clientId]
        );
        if (campaignResult.rowCount !== 1) {
          await client.query('ROLLBACK');
          return res.status(404).json({ status: 'error', code: 'CAMPAIGN_NOT_FOUND' });
        }
      }

      const countResult = await client.query(
        `SELECT COUNT(*)::integer AS count FROM list_memberships WHERE list_id = $1`,
        [listId]
      );
      const rowCount = Number(countResult.rows[0].count);
      if (rowCount > EXPORT_MAX_ROWS) {
        await client.query('ROLLBACK');
        return res.status(413).json({
          status: 'error',
          code: 'EXPORT_ASYNC_REQUIRED',
          max_rows: EXPORT_MAX_ROWS,
          actual_rows: rowCount
        });
      }

      const result = await client.query(
        `
          INSERT INTO export_jobs (
            list_id, client_id, campaign_id, format, status, row_count, created_by, metadata
          )
          VALUES ($1, $2, $3, $4, 'ready', $5, $7, $6::jsonb)
          RETURNING *
        `,
        [
          listId,
          clientId,
          campaignId || null,
          format,
          rowCount,
          JSON.stringify({
            schema: 'lumina-standard-30-v1',
            columns: STANDARD_EXPORT_HEADERS
          }),
          req.auth.principalId
        ]
      );

      await insertAudit(client, {
        action: 'export.created',
        actor: req.auth.principalId,
        entityType: 'export_job',
        entityId: result.rows[0].id,
        clientId,
        details: { list_id: listId, campaign_id: campaignId || null, format, row_count: rowCount }
      });
      await client.query('COMMIT');

      res.status(201).json({
        status: 'ok',
        data: result.rows[0],
        download_path: `/api/v1/exports/${result.rows[0].id}/download`
      });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      handleProductError(res, error, 'EXPORT_CREATE_FAILED');
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/exports/:id/download', async (req, res) => {
    const exportId = cleanText(req.params?.id, 100);
    if (!isUuid(exportId)) return res.status(400).json({ status: 'error', code: 'INVALID_EXPORT_ID' });

    const client = await pool.connect();
    try {
      const clientId = req.auth.clientId;
      const jobResult = await client.query(
        `
          SELECT e.*, l.name AS list_name
          FROM export_jobs e
          LEFT JOIN lists l ON l.id = e.list_id
          WHERE e.id = $1
            AND e.client_id = $2
        `,
        [exportId, clientId]
      );
      if (jobResult.rowCount !== 1) {
        return res.status(404).json({ status: 'error', code: 'EXPORT_NOT_FOUND' });
      }

      const job = jobResult.rows[0];
      const rows = await fetchExportRows(client, {
        listId: job.list_id,
        campaignId: job.campaign_id
      });

      const safeName = (job.list_name || 'lumina-export')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'lumina-export';

      if (job.format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Leads');
        sheet.addRow(STANDARD_EXPORT_HEADERS);
        for (const row of rows) sheet.addRow(rowToExportValues(row));
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        sheet.autoFilter = { from: 'A1', to: 'AD1' };
        const buffer = await workbook.xlsx.writeBuffer();

        await client.query(
          `UPDATE export_jobs SET status = 'completed', row_count = $2, completed_at = NOW() WHERE id = $1`,
          [exportId, rows.length]
        );

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
        return res.send(Buffer.from(buffer));
      }

      const lines = [STANDARD_EXPORT_HEADERS.map(csvCell).join(',')];
      for (const row of rows) lines.push(rowToExportValues(row).map(csvCell).join(','));
      const csv = `${lines.join('\r\n')}\r\n`;

      await client.query(
        `UPDATE export_jobs SET status = 'completed', row_count = $2, completed_at = NOW() WHERE id = $1`,
        [exportId, rows.length]
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
      return res.send(csv);
    } catch (error) {
      if (error?.code === 'EXPORT_ASYNC_REQUIRED') {
        return res.status(413).json({ status: 'error', code: 'EXPORT_ASYNC_REQUIRED', max_rows: EXPORT_MAX_ROWS });
      }
      handleProductError(res, error, 'EXPORT_DOWNLOAD_FAILED');
    } finally {
      client.release();
    }
  });
}
