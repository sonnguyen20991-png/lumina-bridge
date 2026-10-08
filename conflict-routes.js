import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// These are the two text fields exercised by the real-data pilot.
const FIELDS=new Set(['industry','staff_count_range']);
// Display support is independent of permission to resolve a field.
const READ_FIELDS=new Set(['canonical_name','country','industry','staff_count_range']);
class ReviewError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new ReviewError(status,code);};
export function canResolve(auth,reviewers=process.env.LUMINA_SHARED_DATA_REVIEWERS||'') {
 return auth?.provider==='iap'&&['owner','admin'].includes(auth.role)&&UUID.test(auth.principalId||'')&&reviewers.split(',').map(s=>s.trim()).includes(auth.principalId);
}
const iso=v=>v instanceof Date?v.toISOString():v??null;
export function versionOf(c,company,state) {
 return createHash('sha256').update(JSON.stringify([c.id,c.status,c.conflict_type,c.entity_type,c.entity_id,c.field_name,c.existing_value,c.incoming_value,c.source_name,c.source_record_id,c.import_job_id,c.raw_source_row_id,c.evidence,company?.value,iso(company?.updated_at),state?.id,state?.current_value,state?.source_name,state?.source_priority,state?.is_protected,state?.current_observation_id,iso(state?.updated_at)])).digest('hex');
}
function supported(c){return c.entity_type==='company'&&c.conflict_type==='field_value_disagreement'&&FIELDS.has(c.field_name);}
async function snapshot(db,c,lock=false) {
 if(c.entity_type!=='company')return {company:null,state:null,reason:'Only company industry and staff-count field conflicts can be resolved in this release.'};
 const column=READ_FIELDS.has(c.field_name)?c.field_name:'NULL::text';
 const companies=await db.query(`SELECT id,canonical_name,${column} AS value,updated_at FROM companies WHERE id=$1 ${lock?'FOR UPDATE':''}`,[c.entity_id]);
 if(lock)await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`field-policy:company:${c.entity_id}:${c.field_name}`]);
 const states=await db.query(`SELECT id,current_value,source_name,source_priority,is_protected,current_observation_id,updated_at FROM canonical_field_state WHERE company_id=$1 AND field_name=$2 ${lock?'FOR UPDATE':''}`,[c.entity_id,c.field_name]);
 const company=companies.rows[0]??null,state=states.rowCount===1?states.rows[0]:null;
 const reason=!company?'Company no longer exists.':!READ_FIELDS.has(c.field_name)?'Current value is unavailable for this field.':states.rowCount!==1?'Canonical provenance is missing or ambiguous.':state.current_value!==company.value?'Canonical value and provenance disagree.':!supported(c)?'This field is available for review. Only company industry and staff-count conflicts can be resolved from this screen.':null;
 return {company,state,reason};
}
export async function readConflicts(db,auth,jobId,offset=0) {
 const job=await db.query('SELECT id,status FROM import_jobs WHERE id=$1 AND client_id=$2',[jobId,auth.clientId]);
 if(job.rowCount!==1)fail(404,'IMPORT_JOB_NOT_FOUND');
 const result=await db.query('SELECT * FROM conflicts WHERE import_job_id=$1 ORDER BY created_at,id LIMIT 51 OFFSET $2',[jobId,offset]);
 const data=[];
 for(const c of result.rows.slice(0,50)){
  const s=await snapshot(db,c);
  data.push({id:c.id,entity_type:c.entity_type,entity_id:c.entity_id,company_name:s.company?.canonical_name??null,field_name:c.field_name,existing_value:c.existing_value,incoming_value:c.incoming_value,current_value:s.company?.value??null,source_name:c.source_name,status:c.status,conflict_type:c.conflict_type,resolution_note:c.resolution_note,resolved_by:c.resolved_by,resolved_at:c.resolved_at,version:versionOf(c,s.company,s.state),resolvable:c.status==='open'&&job.rows[0].status==='completed'&&supported(c)&&!s.reason,blocked_reason:c.status==='open'?(s.reason??(job.rows[0].status!=='completed'?'Wait for the import job to complete.':null)):null,protected:!!s.state?.is_protected});
 }
 return {status:'ok',data,can_resolve:canResolve(auth),pagination:{offset,limit:50,has_more:result.rowCount>50}};
}
export async function resolveConflict(pool,auth,jobId,conflictId,body) {
 if(!canResolve(auth))fail(403,'SHARED_DATA_REVIEW_FORBIDDEN');
 if(!UUID.test(jobId)||!UUID.test(conflictId))fail(400,'INVALID_REVIEW_ID');
 if(!body||!['keep_existing','accept_incoming'].includes(body.decision)||! /^[a-f0-9]{64}$/.test(body.version||'')||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000||body.acknowledge_shared!==true)fail(400,'INVALID_REVIEW_DECISION');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout = '5s'");
  await db.query("SET LOCAL statement_timeout = '15s'");
  const membership=await db.query(`SELECT cm.role FROM client_memberships cm JOIN app_principals p ON p.id=cm.principal_id JOIN clients cl ON cl.id=cm.client_id WHERE cm.principal_id=$1 AND cm.client_id=$2 AND cm.status='active' AND p.status='active' AND p.provider='iap' AND cl.status='active' AND cm.role IN ('owner','admin') FOR SHARE OF cm,p,cl`,[auth.principalId,auth.clientId]);
  if(membership.rowCount!==1)fail(403,'SHARED_DATA_REVIEW_FORBIDDEN');
  const scoped=await db.query(`SELECT c.* FROM conflicts c JOIN import_jobs j ON j.id=c.import_job_id WHERE c.id=$1 AND j.id=$2 AND j.client_id=$3 AND j.status='completed'`,[conflictId,jobId,auth.clientId]);
  if(scoped.rowCount!==1)fail(404,'COMPLETED_JOB_CONFLICT_NOT_FOUND');
  let c=scoped.rows[0];
  if(!supported(c))fail(400,'UNSUPPORTED_CONFLICT_TYPE');
  // Match importer order: company row, field advisory lock, provenance state.
  const s=await snapshot(db,c,true);
  const locked=await db.query('SELECT * FROM conflicts WHERE id=$1 FOR UPDATE',[conflictId]);
  c=locked.rows[0];
  if(!supported(c)||c.import_job_id!==jobId)fail(409,'REVIEW_STALE_REFRESH_REQUIRED');
  if(c.status!=='open')fail(409,'CONFLICT_ALREADY_RESOLVED');
  if(s.reason)fail(409,'CANONICAL_PROVENANCE_INCONSISTENT');
  if(body.version!==versionOf(c,s.company,s.state))fail(409,'REVIEW_STALE_REFRESH_REQUIRED');
  if(body.decision==='accept_incoming'&&(typeof c.incoming_value!=='string'||!c.incoming_value.trim()||c.incoming_value.length>2000))fail(400,'INVALID_INCOMING_VALUE');
  const accept=body.decision==='accept_incoming';
  const source=accept?'manual_conflict_review':c.source_name||'unknown';
  const rawPriority=Number(c.evidence?.incoming_priority??50);
  const priority=accept?100:(Number.isInteger(rawPriority)&&rawPriority>=0&&rawPriority<=100?rawPriority:50);
  const details={principal_id:auth.principalId,client_id:auth.clientId,conflict_id:c.id,decision:body.decision,note:body.note.trim(),before:s.company.value,incoming:c.incoming_value,after:accept?c.incoming_value:s.company.value,source_name:c.source_name,source_record_id:c.source_record_id,shared_company:true};
  const obs=await db.query(`INSERT INTO field_observations (company_id,field_name,observed_value,normalized_value,source_name,source_record_id,source_priority,decision,import_job_id,raw_source_row_id,metadata) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,[c.entity_id,c.field_name,JSON.stringify(c.incoming_value),c.incoming_value?.trim().toLocaleLowerCase()??null,source,c.source_record_id,priority,accept?'accepted':'kept_existing',jobId,c.raw_source_row_id,JSON.stringify(details)]);
  if(accept){
   await db.query(`UPDATE companies SET ${c.field_name}=$2,updated_at=NOW() WHERE id=$1`,[c.entity_id,c.incoming_value]);
   await db.query(`UPDATE canonical_field_state SET current_value=$2::jsonb,normalized_value=$3,source_name=$4,source_priority=100,is_protected=true,current_observation_id=$5,metadata=metadata||$6::jsonb,updated_at=NOW() WHERE id=$1`,[s.state.id,JSON.stringify(c.incoming_value),c.incoming_value.trim().toLocaleLowerCase(),source,obs.rows[0].id,JSON.stringify(details)]);
  }
  const status=accept?'resolved_incoming':'resolved_existing';
  await db.query('UPDATE conflicts SET status=$2,resolution_note=$3,resolved_by=$4,resolved_at=NOW() WHERE id=$1',[c.id,status,body.note.trim(),auth.principalId]);
  await db.query(`INSERT INTO audit_events (actor,action,entity_type,entity_id,client_id,details) VALUES ($1,'canonical_field.conflict_resolved','company',$2,$3,$4::jsonb)`,[auth.principalId,c.entity_id,auth.clientId,JSON.stringify({...details,observation_id:obs.rows[0].id,protected_after:accept||s.state.is_protected})]);
  await db.query('COMMIT');
  return {status:'ok',data:{id:c.id,status,current_value:details.after}};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
export function registerConflictRoutes(app,pool){
 const error=(res,e)=>{if(!(e instanceof ReviewError))console.error('Conflict review failed:',e.message);return res.status(e.status||500).json({status:'error',code:e.code&&e instanceof ReviewError?e.code:'CONFLICT_REVIEW_FAILED'});};
 app.get('/api/v1/import-jobs/:id/conflicts',async(req,res)=>{
  try{if(!UUID.test(req.params.id))fail(400,'INVALID_REVIEW_ID');const offset=Number(req.query.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)fail(400,'INVALID_OFFSET');return res.json(await readConflicts(pool,req.auth,req.params.id,offset));}catch(e){return error(res,e);}
 });
 app.post('/api/v1/import-jobs/:id/conflicts/:conflictId/resolve',async(req,res)=>{
  try{
   if(req.get('X-Lumina-Review')!=='1'||!req.is('application/json'))fail(400,'REVIEW_JSON_REQUIRED');
   if(req.get('Origin')&&new URL(req.get('Origin')).host!==req.get('Host'))fail(403,'REVIEW_ORIGIN_DENIED');
   return res.json(await resolveConflict(pool,req.auth,req.params.id,req.params.conflictId,req.body));
  }catch(e){return error(res,e);}
 });
}
