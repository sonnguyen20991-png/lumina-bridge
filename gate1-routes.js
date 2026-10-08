const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(['title', 'department', 'seniority', 'location', 'city', 'country', 'company', 'industry', 'domain', 'email', 'icp']);

export function validateQuery(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'INVALID_QUERY';
  if (value.q != null && (typeof value.q !== 'string' || value.q.length > 1000)) return 'INVALID_QUERY';
  const filters = value.filters ?? {};
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return 'INVALID_FILTERS';
  for (const [field, item] of Object.entries(filters)) {
    if (field === 'icp' && (typeof item !== 'string' || !UUID.test(item))) return 'INVALID_ICP_FILTER';
    if (!FIELDS.has(field)) return 'UNSUPPORTED_FILTER';
    if (typeof item !== 'string' || !item.trim() || item.length > 500) return 'INVALID_FILTER_VALUE';
  }
  return null;
}

export function registerGate1Routes(app, pool) {
  // Register AFTER authorization and BEFORE existing product routes.
  app.get('/api/v1/session', (req, res) => {
    const a = req.auth;
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', data: {
      principal_id: a.principalId, email: a.email, client_id: a.clientId,
      client_name: a.clientName, role: a.role, provider: a.provider
    } });
  });

  for (const path of ['/api/v1/search/people', '/api/v1/search/interpret', '/api/v1/saved-targets']) {
    app.post(path, (req, res, next) => {
      const body = req.body || {};
      const error = validateQuery(body.interpreted_query ?? { q: body.q, filters: body.filters });
      if (error) return res.status(400).json({ status: 'error', code: error });
      if (body.input != null && (typeof body.input !== 'string' || body.input.length > 3000)) {
        return res.status(400).json({ status: 'error', code: 'INVALID_INPUT' });
      }
      // Existing search handler reads top-level q/filters. Execute the reviewed
      // snapshot without reinterpreting the original phrase on Apply.
      if (path === '/api/v1/search/people' && body.interpreted_query != null) {
        req.body = { ...body, q: body.interpreted_query.q || '', filters: body.interpreted_query.filters || {}, input: '' };
      }
      next();
    });
  }

  app.post('/api/v1/lists/from-selection', async (req, res) => {
    const body = req.body || {};
    const ids = body.person_ids;
    const error = validateQuery(body.interpreted_query || {});
    if (error) return res.status(400).json({ status: 'error', code: error });
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 300) {
      return res.status(400).json({ status: 'error', code: 'NAME_REQUIRED' });
    }
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => !UUID.test(id))) {
      return res.status(400).json({ status: 'error', code: 'INVALID_PERSON_IDS' });
    }
    const uniqueIds = [...new Set(ids)];
    const a = req.auth;
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const existing = await client.query('SELECT id FROM persons WHERE id = ANY($1::uuid[]) AND status = \'active\' FOR SHARE', [uniqueIds]);
      if (existing.rowCount !== uniqueIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ status: 'error', code: 'PERSON_SELECTION_INVALID' });
      }
      const metadata = {
        origin: 'Target Builder', original_input: typeof body.original_input === 'string' ? body.original_input.slice(0, 3000) : null,
        interpreted_query: body.interpreted_query || {}, selected_person_ids: uniqueIds,
        principal_id: a.principalId, matching_mode: 'substring_or_trigram',
        created_at: new Date().toISOString()
      };
      const list = await client.query(`INSERT INTO lists (client_id, name, description, list_type, created_by, metadata)
        VALUES ($1,$2,$3,'static',$4,$5::jsonb) RETURNING *`, [a.clientId, body.name.trim(),
        typeof body.description === 'string' ? body.description.slice(0,2000) : null, a.principalId, JSON.stringify(metadata)]);
      const listId = list.rows[0].id;
      await client.query(`INSERT INTO list_memberships (list_id, person_id, added_by, metadata)
        SELECT $1, id, $3, '{"source":"target_selection"}'::jsonb FROM unnest($2::uuid[]) AS id`,
        [listId, uniqueIds, a.principalId]);
      await client.query(`INSERT INTO audit_events (actor,action,entity_type,entity_id,client_id,details)
        VALUES ($1,'list.created_from_selection','list',$2,$3,$4::jsonb)`,
        [a.principalId, listId, a.clientId, JSON.stringify({ ...metadata, member_count: uniqueIds.length })]);
      await client.query('COMMIT');
      return res.status(201).json({ status: 'ok', data: list.rows[0], member_count: uniqueIds.length });
    } catch (error) {
      if (client) { try { await client.query('ROLLBACK'); } catch {} }
      console.error('Selected list creation failed:', error);
      return res.status(500).json({ status: 'error', code: 'SELECTED_LIST_CREATE_FAILED' });
    } finally { client?.release(); }
  });
}
