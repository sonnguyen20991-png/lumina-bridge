const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const writeRoles = new Set(['owner','admin','manager','member']);
const outcomes = new Set(['all','inserted','updated','matched','processed','review','rejected','suppressed','pending']);
const fail = (res,status,code) => res.status(status).json({status:'error',code});
export function parseReviewQuery(query={}) {
  const outcome=query.outcome??'all', q=query.q??'', offset=query.offset??'0';
  if(typeof outcome!=='string'||!outcomes.has(outcome)||typeof q!=='string'||q.length>200||typeof offset!=='string'||!/^\d{1,7}$/.test(offset)||Number(offset)>1000000) return null;
  return {outcome,q:q.trim(),offset:Number(offset),limit:50};
}
// Outcome comes from the import audit, not the contact's present-day update time.
const rowsSql = `WITH import_audits AS MATERIALIZED (
 SELECT DISTINCT ON(entity_id,details->>'row_number') entity_id,details->>'row_number' AS source_row,action
 FROM audit_events WHERE entity_type='person' AND details->>'import_job_id'=($1::uuid)::text
 AND action IN ('person.import_created','person.import_updated','person.import_matched')
 ORDER BY entity_id,details->>'row_number',created_at DESC,id DESC
), review_rows AS (
 SELECT r.id AS row_id,r.row_number,r.canonical_person_id AS person_id,
 p.status AS person_status,p.full_name,p.current_title,p.contact_country,p.linkedin_url,p.department,p.seniority,
 c.canonical_name AS company_name,c.domain AS company_domain,
 coalesce((SELECT e.email FROM emails e WHERE e.person_id=p.id ORDER BY (e.normalized_email=lumina_normalize_email(r.raw_payload->>'email')) DESC NULLS LAST,e.is_primary DESC,e.id LIMIT 1),'') AS email,
 r.raw_payload,r.processing_status,r.resolution_method,
 coalesce(r.processing_error,r.resolution_notes->>'reason',r.resolution_notes->>'code') AS reason,
 CASE WHEN r.processing_status='rejected' THEN 'rejected'
 WHEN r.processing_status='suppressed' THEN 'suppressed'
 WHEN r.processing_status='conflict' OR EXISTS(SELECT 1 FROM conflicts f WHERE f.raw_source_row_id=r.id AND f.import_job_id=$1::uuid) THEN 'review'
 WHEN r.processing_status IN ('queued','processing') THEN 'pending'
 WHEN r.processing_status='processed' AND a.action='person.import_created' THEN 'inserted'
 WHEN r.processing_status='processed' AND (a.action='person.import_updated' OR r.resolution_notes->>'company_canonical_changed'='true') THEN 'updated'
 WHEN r.processing_status='processed' AND a.action='person.import_matched' THEN 'matched'
 WHEN r.processing_status='processed' THEN 'processed' ELSE 'review' END AS outcome
 FROM raw_source_rows r JOIN import_jobs j ON j.id=r.import_job_id AND j.client_id=$2
 LEFT JOIN persons p ON p.id=r.canonical_person_id
 LEFT JOIN companies c ON c.id=r.canonical_company_id
 LEFT JOIN import_audits a ON a.entity_id=r.canonical_person_id AND a.source_row=r.row_number::text
 WHERE r.import_job_id=$1::uuid
), filtered AS (
 SELECT * FROM review_rows WHERE ($3='all' OR outcome=$3) AND ($4='' OR strpos(lower(coalesce(full_name,'')||' '||email||' '||coalesce(company_name,'')||' '||coalesce(raw_payload->>'full_name','')||' '||coalesce(raw_payload->>'email','')),lower($4))>0)
)
SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.row_number,page.row_id) FROM (SELECT * FROM filtered ORDER BY row_number,row_id LIMIT 50 OFFSET $5) page),'[]'::jsonb)) AS result`;
export function registerImportReviewRoutes(app,pool) {
 const run=fn=>async(req,res)=>{
  if(!req.auth?.clientId||!req.auth?.principalId)return fail(res,401,'AUTHENTICATION_REQUIRED');
  if(req.method==='POST'&&!writeRoles.has(req.auth.role))return fail(res,403,'INSUFFICIENT_ROLE');
  let c;
  try {c=await pool.connect();await fn(req,res,c);}
  catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});console.error('Import review failed:',e.message);if(!res.headersSent)fail(res,500,'IMPORT_REVIEW_FAILED');}
  finally{c?.release();}
 };
 app.get('/api/v1/import-jobs/:id/rows',run(async(req,res,c)=>{
  if(!uuid(req.params.id))return fail(res,400,'INVALID_IMPORT_JOB_ID');
  const query=parseReviewQuery(req.query);if(!query)return fail(res,400,'INVALID_REVIEW_FILTER');
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const owned=await c.query('SELECT * FROM import_jobs WHERE id=$1 AND client_id=$2',[req.params.id,req.auth.clientId]);
  if(!owned.rowCount){await c.query('ROLLBACK');return fail(res,404,'IMPORT_JOB_NOT_FOUND');}
  const result=await c.query(rowsSql,[req.params.id,req.auth.clientId,query.outcome,query.q,query.offset]);
  await c.query('COMMIT');res.set('Cache-Control','no-store');
  res.json({status:'ok',data:{job:owned.rows[0],rows:result.rows[0].result.rows,total:result.rows[0].result.total,pagination:{limit:50,offset:query.offset},can_create_list:writeRoles.has(req.auth.role)}});
 }));
 app.post('/api/v1/import-jobs/:id/review-list',run(async(req,res,c)=>{
  const b=req.body||{},ids=b.person_ids;
  if(!uuid(req.params.id)||!uuid(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>300||!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>!uuid(id)))return fail(res,400,'INVALID_IMPORT_LIST');
  const unique=[...new Set(ids)].sort();await c.query('BEGIN');
  const owned=await c.query('SELECT id,filename FROM import_jobs WHERE id=$1 AND client_id=$2 FOR SHARE',[req.params.id,req.auth.clientId]);
  if(!owned.rowCount){await c.query('ROLLBACK');return fail(res,404,'IMPORT_JOB_NOT_FOUND');}
  const people=await c.query(`SELECT p.id FROM persons p WHERE p.status='active' AND p.id=ANY($3::uuid[]) AND EXISTS(SELECT 1 FROM raw_source_rows r JOIN import_jobs j ON j.id=r.import_job_id AND j.client_id=$2 WHERE r.import_job_id=$1 AND r.canonical_person_id=p.id AND r.processing_status='processed') FOR SHARE OF p`,[req.params.id,req.auth.clientId,unique]);
  if(people.rowCount!==unique.length){await c.query('ROLLBACK');return fail(res,400,'IMPORT_SELECTION_INVALID');}
  const metadata={origin:'Import review',import_job_id:req.params.id,filename:owned.rows[0].filename,selected_person_ids:unique,principal_id:req.auth.principalId};
  const list=await c.query(`INSERT INTO lists(id,client_id,name,list_type,created_by,metadata) VALUES($1,$2,$3,'static',$4,$5::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`,[b.id,req.auth.clientId,b.name.trim(),req.auth.principalId,JSON.stringify(metadata)]);
  if(!list.rowCount){
   const existing=await c.query('SELECT * FROM lists WHERE id=$1 AND client_id=$2',[b.id,req.auth.clientId]);
   const old=existing.rows[0];
   if(!old||old.name!==b.name.trim()||old.metadata?.import_job_id!==req.params.id||old.metadata?.principal_id!==req.auth.principalId||JSON.stringify(old.metadata?.selected_person_ids)!==JSON.stringify(unique)){await c.query('ROLLBACK');return fail(res,409,'LIST_REPLAY_MISMATCH');}
   await c.query('COMMIT');return res.json({status:'ok',data:old,member_count:unique.length});
  }
  await c.query(`INSERT INTO list_memberships(list_id,person_id,added_by,metadata) SELECT $1,id,$3,$4::jsonb FROM unnest($2::uuid[]) AS id`,[b.id,unique,req.auth.principalId,JSON.stringify({source:'import_review',import_job_id:req.params.id})]);
  await c.query(`INSERT INTO audit_events(actor,action,entity_type,entity_id,client_id,details) VALUES($1,'list.created_from_import','list',$2,$3,$4::jsonb)`,[req.auth.principalId,b.id,req.auth.clientId,JSON.stringify({...metadata,member_count:unique.length})]);
  await c.query('COMMIT');res.status(201).json({status:'ok',data:list.rows[0],member_count:unique.length});
 }));
}
