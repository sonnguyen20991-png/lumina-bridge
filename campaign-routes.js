const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const writeRoles = new Set(['owner','admin','manager','member']);
const stages = new Set(['not_started','contacted','responded','meeting_booked','qualified','closed']);
const statuses = new Set(['active','paused','completed','not_interested']);
export function validateParticipation(b) {
  if (!b || !stages.has(b.stage) || !statuses.has(b.status) || typeof b.note !== 'string' || b.note.length > 5000) return false;
  if (typeof b.expected_updated_at !== 'string' || !Number.isFinite(Date.parse(b.expected_updated_at))) return false;
  for (const k of ['first_contacted_at','last_contacted_at']) if (b[k] !== null && (typeof b[k] !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(b[k]) || !Number.isFinite(Date.parse(b[k])))) return false;
  return !(b.first_contacted_at && b.last_contacted_at && Date.parse(b.first_contacted_at) > Date.parse(b.last_contacted_at));
}
export function registerCampaignRoutes(app, pool) {
  const error = (res,n,code) => res.status(n).json({status:'error',code});
  const run = fn => async (req,res) => {
    if (!req.auth?.clientId || !req.auth?.principalId) return error(res,401,'AUTHENTICATION_REQUIRED');
    if (req.method === 'POST' && !writeRoles.has(req.auth.role)) return error(res,403,'INSUFFICIENT_ROLE');
    let c;
    try { c=await pool.connect(); await fn(req,res,c); }
    catch(e) { if(c) await c.query('ROLLBACK').catch(()=>{}); console.error('Campaign request failed:', e.message); if(!res.headersSent) error(res,500,'CAMPAIGN_REQUEST_FAILED'); }
    finally { c?.release(); }
  };
  async function audit(c,a,action,id,details) {
    await c.query('INSERT INTO audit_events(actor,action,entity_type,entity_id,client_id,details) VALUES($1,$2,\'campaign\',$3,$4,$5::jsonb)',[a.principalId,action,id,a.clientId,JSON.stringify(details)]);
  }
  async function event(c,a,campaignId,personId,action,details) {
    await c.query('INSERT INTO campaign_history_events(client_id,campaign_id,person_id,actor,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[a.clientId,campaignId,personId,a.principalId,action,JSON.stringify(details)]);
  }
  app.get('/api/v1/campaigns',run(async(req,res,c)=>{
    const r=await c.query('SELECT c.*, COUNT(cp.person_id)::integer AS participant_count FROM campaigns c LEFT JOIN campaign_participations cp ON cp.campaign_id=c.id WHERE c.client_id=$1 GROUP BY c.id ORDER BY c.updated_at DESC,c.id',[req.auth.clientId]);
    res.json({status:'ok',data:r.rows});
  }));
  app.post('/api/v1/campaigns',run(async(req,res,c)=>{
    const b=req.body||{};
    if(!uuid(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>300) return error(res,400,'INVALID_CAMPAIGN');
    await c.query('BEGIN');
    const r=await c.query(`INSERT INTO campaigns(id,client_id,name,status,metadata) VALUES($1,$2,$3,'active',$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`,[b.id,req.auth.clientId,b.name.trim(),JSON.stringify({created_by:req.auth.principalId})]);
    if(!r.rowCount) {
      const old=await c.query('SELECT * FROM campaigns WHERE id=$1 AND client_id=$2',[b.id,req.auth.clientId]);
      if(!old.rowCount||old.rows[0].name!==b.name.trim()) {await c.query('ROLLBACK');return error(res,409,'CAMPAIGN_REPLAY_MISMATCH');}
      await c.query('COMMIT');return res.json({status:'ok',data:old.rows[0]});
    }
    await audit(c,req.auth,'campaign.created',b.id,{name:b.name.trim()});
    await c.query('COMMIT');res.status(201).json({status:'ok',data:r.rows[0]});
  }));
  app.post('/api/v1/campaigns/:id/import-list',run(async(req,res,c)=>{
    const id=req.params.id, list=req.body?.list_id;
    if(!uuid(id)||!uuid(list)) return error(res,400,'INVALID_CAMPAIGN_OR_LIST_ID');
    await c.query('BEGIN');
    const owned=await c.query('SELECT id FROM campaigns WHERE id=$1 AND client_id=$2 FOR UPDATE',[id,req.auth.clientId]);
    const l=await c.query('SELECT id FROM lists WHERE id=$1 AND client_id=$2 FOR SHARE',[list,req.auth.clientId]);
    if(!owned.rowCount||!l.rowCount){await c.query('ROLLBACK');return error(res,404,'CAMPAIGN_OR_LIST_NOT_FOUND');}
    const r=await c.query(`INSERT INTO campaign_participations(campaign_id,person_id,stage,status,metadata) SELECT $1,lm.person_id,'not_started','active',$3::jsonb FROM list_memberships lm JOIN persons p ON p.id=lm.person_id AND p.status='active' WHERE lm.list_id=$2 ON CONFLICT(campaign_id,person_id) DO NOTHING RETURNING person_id`,[id,list,JSON.stringify({source:'list_import',list_id:list,added_by:req.auth.principalId})]);
    if(r.rowCount) {
      await c.query(`INSERT INTO campaign_history_events(client_id,campaign_id,person_id,actor,action,details) SELECT $1,$2,person_id,$4,'added_from_list',$5::jsonb FROM unnest($3::uuid[]) AS person_id`,[req.auth.clientId,id,r.rows.map(p=>p.person_id),req.auth.principalId,JSON.stringify({list_id:list})]);
      await audit(c,req.auth,'campaign.list_imported',id,{list_id:list,added:r.rowCount});
      await c.query('UPDATE campaigns SET updated_at=NOW() WHERE id=$1',[id]);
    }
    await c.query('COMMIT');res.json({status:'ok',data:{added:r.rowCount}});
  }));
  app.get('/api/v1/campaigns/:id/participants',run(async(req,res,c)=>{
    const id=req.params.id;if(!uuid(id)) return error(res,400,'INVALID_CAMPAIGN_ID');
    const owned=await c.query('SELECT id FROM campaigns WHERE id=$1 AND client_id=$2',[id,req.auth.clientId]);
    if(!owned.rowCount) return error(res,404,'CAMPAIGN_NOT_FOUND');
    const offset=Math.max(0,Math.min(1000000,Number.parseInt(req.query.offset,10)||0));
    const r=await c.query(`SELECT cp.*,cp.updated_at::text AS version,p.full_name,p.current_title,p.contact_country FROM campaign_participations cp JOIN persons p ON p.id=cp.person_id JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.campaign_id=$1 AND c.client_id=$2 ORDER BY cp.created_at,cp.person_id LIMIT 50 OFFSET $3`,[id,req.auth.clientId,offset]);
    res.json({status:'ok',data:r.rows,pagination:{limit:50,offset}});
  }));
  app.post('/api/v1/campaigns/:id/participants/:personId',run(async(req,res,c)=>{
    const id=req.params.id,p=req.params.personId,b=req.body;
    if(!uuid(id)||!uuid(p)||!validateParticipation(b)) return error(res,400,'INVALID_PARTICIPATION_UPDATE');
    await c.query('BEGIN');
    const r=await c.query(`SELECT cp.*,cp.updated_at::text AS version FROM campaign_participations cp JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.campaign_id=$1 AND cp.person_id=$2 AND c.client_id=$3 FOR UPDATE OF cp`,[id,p,req.auth.clientId]);
    if(!r.rowCount){await c.query('ROLLBACK');return error(res,404,'PARTICIPATION_NOT_FOUND');}
    const old=r.rows[0];
    if(old.version!==b.expected_updated_at){await c.query('ROLLBACK');return error(res,409,'PARTICIPATION_CHANGED_REFRESH');}
    const snapshot=x=>({stage:x.stage,status:x.status,note:x.note||'',first_contacted_at:x.first_contacted_at?new Date(x.first_contacted_at).toISOString():null,last_contacted_at:x.last_contacted_at?new Date(x.last_contacted_at).toISOString():null});
    const before=snapshot(old),after=snapshot(b);
    if(JSON.stringify(before)===JSON.stringify(after)){await c.query('COMMIT');return res.json({status:'ok',data:old});}
    const updated=await c.query(`UPDATE campaign_participations SET stage=$3,status=$4,note=$5,first_contacted_at=$6,last_contacted_at=$7,updated_at=clock_timestamp() WHERE campaign_id=$1 AND person_id=$2 RETURNING *,updated_at::text AS version`,[id,p,b.stage,b.status,b.note,b.first_contacted_at,b.last_contacted_at]);
    await event(c,req.auth,id,p,'participation_updated',{before,after});
    await audit(c,req.auth,'campaign.participation_updated',id,{person_id:p,before,after});
    await c.query('UPDATE campaigns SET updated_at=NOW() WHERE id=$1',[id]);
    await c.query('COMMIT');res.json({status:'ok',data:updated.rows[0]});
  }));
  app.get('/api/v1/people/:id/campaign-history',run(async(req,res,c)=>{
    if(!uuid(req.params.id)) return error(res,400,'INVALID_PERSON_ID');
    const r=await c.query(`SELECT c.id AS campaign_id,c.name AS campaign_name,c.status AS campaign_status,cp.stage,cp.status AS participation_status,cp.first_contacted_at,cp.last_contacted_at,cp.note,cp.created_at,cp.updated_at FROM campaign_participations cp JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.person_id=$1 AND c.client_id=$2 ORDER BY cp.updated_at DESC,c.name`,[req.params.id,req.auth.clientId]);
    const events=await c.query(`SELECT e.*,c.name AS campaign_name FROM campaign_history_events e JOIN campaigns c ON c.id=e.campaign_id WHERE e.person_id=$1 AND e.client_id=$2 AND c.client_id=$2 ORDER BY e.created_at DESC,e.id LIMIT 100`,[req.params.id,req.auth.clientId]);
    res.json({status:'ok',data:r.rows,events:events.rows,event_limit:100});
  }));
}
