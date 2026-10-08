const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE = new Set(['owner', 'admin', 'manager', 'member']);
const fail = (res, status, code) => res.status(status).json({status:'error', code});
export function registerIcpRoutes(app, pool) {
  app.get('/api/v1/icps', async (req, res) => {
    try {
      const result = await pool.query(`SELECT i.id, i.name, i.description, i.created_at,
        (SELECT COUNT(*)::integer FROM person_icp_tags t JOIN persons p ON p.id=t.person_id
         WHERE t.client_id=i.client_id AND t.icp_id=i.id AND p.status='active') AS member_count
        FROM icp_definitions i WHERE i.client_id=$1 ORDER BY lower(i.name), i.id`, [req.auth.clientId]);
      res.json({status:'ok', data:result.rows});
    } catch (e) {console.error('ICP list failed:', e);fail(res,500,'ICP_LIST_FAILED');}
  });
  app.post('/api/v1/icps', async (req, res) => {
    if (!WRITE.has(req.auth?.role)) return fail(res,403,'INSUFFICIENT_ROLE');
    const {id, name, description=''} = req.body || {};
    if (typeof id!=='string' || !UUID.test(id)) return fail(res,400,'INVALID_ICP_ID');
    if (typeof name!=='string' || !name.trim() || name.length>120) return fail(res,400,'INVALID_ICP_NAME');
    if (typeof description!=='string' || description.length>2000) return fail(res,400,'INVALID_ICP_DESCRIPTION');
    let client;
    try {
      client=await pool.connect();await client.query('BEGIN');
      // Same ID and content is a safe replay; a different payload cannot reuse it.
      const result=await client.query(`INSERT INTO icp_definitions (id,client_id,name,description,created_by)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [id,req.auth.clientId,name.trim(),description.trim(),req.auth.principalId]);
      if (!result.rowCount) {
        const existing=await client.query('SELECT * FROM icp_definitions WHERE id=$1 AND client_id=$2', [id,req.auth.clientId]);
        await client.query('ROLLBACK');
        if (!existing.rowCount) return fail(res,409,'ICP_ID_UNAVAILABLE');
        const i=existing.rows[0];
        if(i.name!==name.trim() || i.description!==description.trim())return fail(res,409,'ICP_REPLAY_MISMATCH');
        return res.json({status:'ok',data:i});
      }
      await client.query(`INSERT INTO audit_events (actor,action,entity_type,entity_id,client_id,details)
        VALUES ($1,'icp.created','icp',$2,$3,$4::jsonb)`,
        [req.auth.principalId,id,req.auth.clientId,JSON.stringify({name:name.trim()})]);
      await client.query('COMMIT');res.status(201).json({status:'ok',data:result.rows[0]});
    } catch(e) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      if(e.code==='23505')return fail(res,409,'ICP_NAME_EXISTS');
      console.error('ICP create failed:',e);fail(res,500,'ICP_CREATE_FAILED');
    } finally {client?.release();}
  });
  app.post('/api/v1/icps/:id/assignments', async (req,res) => {
    if (!WRITE.has(req.auth?.role))return fail(res,403,'INSUFFICIENT_ROLE');
    const id=req.params.id, {person_ids:ids,action}=req.body || {};
    if(!UUID.test(id))return fail(res,400,'INVALID_ICP_ID');
    if(!['add','remove'].includes(action))return fail(res,400,'INVALID_ICP_ACTION');
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(i=>typeof i!=='string'||!UUID.test(i)))return fail(res,400,'INVALID_PERSON_IDS');
    const unique=[...new Set(ids.map(i=>i.toLowerCase()))].sort();
    let client;
    try {
      client=await pool.connect();await client.query('BEGIN');
      // Serialize changes to a tag, including its audit record.
      const icp=await client.query('SELECT id FROM icp_definitions WHERE id=$1 AND client_id=$2 FOR UPDATE',[id,req.auth.clientId]);
      if(!icp.rowCount){await client.query('ROLLBACK');return fail(res,404,'ICP_NOT_FOUND');}
      const people=await client.query("SELECT id FROM persons WHERE id=ANY($1::uuid[]) AND status='active' ORDER BY id FOR SHARE",[unique]);
      if(people.rowCount!==unique.length){await client.query('ROLLBACK');return fail(res,400,'PERSON_SELECTION_INVALID');}
      const changed= action==='add' ? await client.query(`INSERT INTO person_icp_tags (client_id,icp_id,person_id,assigned_by)
        SELECT $1,$2,p,$4 FROM unnest($3::uuid[]) AS p ON CONFLICT (client_id,icp_id,person_id) DO NOTHING RETURNING person_id`,
        [req.auth.clientId,id,unique,req.auth.principalId]) : await client.query(`DELETE FROM person_icp_tags
        WHERE client_id=$1 AND icp_id=$2 AND person_id=ANY($3::uuid[]) RETURNING person_id`,[req.auth.clientId,id,unique]);
      if(changed.rowCount)await client.query(`INSERT INTO audit_events (actor,action,entity_type,entity_id,client_id,details)
        VALUES ($1,$2,'icp',$3,$4,$5::jsonb)`,[req.auth.principalId,action==='add'?'icp.contacts_tagged':'icp.contacts_untagged',id,req.auth.clientId,
        JSON.stringify({person_ids:changed.rows.map(r=>r.person_id),changed_count:changed.rowCount})]);
      const readback=await client.query(`SELECT person_id FROM person_icp_tags WHERE client_id=$1 AND icp_id=$2 AND person_id=ANY($3::uuid[])`,[req.auth.clientId,id,unique]);
      await client.query('COMMIT');res.json({status:'ok',data:{icp_id:id,action,changed_count:changed.rowCount,tagged_person_ids:readback.rows.map(r=>r.person_id)}});
    } catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});console.error('ICP assignment failed:',e);fail(res,500,'ICP_ASSIGNMENT_FAILED');}
    finally{client?.release();}
  });
}
