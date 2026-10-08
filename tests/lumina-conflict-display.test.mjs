import test from 'node:test';
import assert from 'node:assert/strict';
import {readConflicts,resolveConflict,versionOf} from '../conflict-routes.js';
const principal='d6adcdbb-df25-4457-870f-5c093baf8771';
const job='fa25f384-d077-4745-b329-46e621cd9e4d';
const entity='3bf80747-c60c-4c64-921b-b74bb0488064';
const auth={provider:'iap',role:'owner',principalId:principal,clientId:'777b940f-dbc1-44b3-b569-a89661bde598'};
process.env.LUMINA_SHARED_DATA_REVIEWERS=principal;
function fixture({field='country',status='resolved_existing',missing=false,foreign=false}={}){
 const calls=[];
 const conflict={id:'cb4034de-3f8e-401a-9311-d0b3322934aa',entity_type:'company',entity_id:entity,field_name:field,status,conflict_type:'field_value_disagreement',existing_value:'Indonesia',incoming_value:'United States',import_job_id:job};
 const company={id:entity,canonical_name:'Telin',value:field==='canonical_name'?'Telin':'Indonesia',updated_at:'2026-10-04T10:00:00Z'};
 const state={id:job,current_value:company.value,source_priority:100,is_protected:true,updated_at:company.updated_at};
 const result=rows=>({rows,rowCount:rows.length});
 const db={async query(sql,p=[]){calls.push({sql,p});
  if(sql.startsWith('SELECT id,status FROM import_jobs')){assert.equal(p[1],auth.clientId);return result(foreign?[]:[{id:job,status:'completed'}]);}
  if(sql.includes('FROM conflicts WHERE import_job_id'))return result([conflict]);
  if(sql.includes('FROM companies')){assert.equal(p[0],entity);return result(missing?[]:[company]);}
  if(sql.includes('FROM canonical_field_state'))return result([state]);
  if(sql.includes('SELECT cm.role'))return result([{role:'owner'}]);
  if(sql.includes('JOIN import_jobs j'))return result([conflict]);
  if(['BEGIN','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL'))return result([]);
  throw new Error('Unexpected query '+sql);
 },release(){}};
 return {db,calls,conflict,company,state};
}
test('resolved country displays current company name and country without an action warning',async()=>{
 const f=fixture();const r=(await readConflicts(f.db,auth,job)).data[0];
 assert.equal(r.company_name,'Telin');assert.equal(r.current_value,'Indonesia');
 assert.equal(r.status,'resolved_existing');assert.equal(r.protected,true);
 assert.equal(r.resolvable,false);assert.equal(r.blocked_reason,null);
 assert.equal(r.version,versionOf(f.conflict,f.company,f.state));
 assert.equal(f.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)),false);
});
test('open country is readable to viewer but cannot be resolved',async()=>{
 const f=fixture({status:'open'});const page=await readConflicts(f.db,{...auth,role:'viewer'},job);
 assert.equal(page.can_resolve,false);assert.equal(page.data[0].current_value,'Indonesia');
 assert.equal(page.data[0].resolvable,false);assert.match(page.data[0].blocked_reason,/available for review/);
});
test('company-name conflicts expose the current name without broadening write support',async()=>{
 const f=fixture({field:'canonical_name',status:'open'});const r=(await readConflicts(f.db,auth,job)).data[0];
 assert.equal(r.company_name,'Telin');assert.equal(r.current_value,'Telin');assert.equal(r.resolvable,false);
});
test('readable country is still rejected by direct resolution before any mutation',async()=>{
 const f=fixture({status:'open'});
 await assert.rejects(resolveConflict({connect:async()=>f.db},auth,job,f.conflict.id,{decision:'accept_incoming',version:'a'.repeat(64),note:'Test',acknowledge_shared:true}),/UNSUPPORTED_CONFLICT_TYPE/);
 assert.equal(f.calls.some(c=>/^(INSERT|UPDATE|DELETE)/.test(c.sql)),false);
});
test('foreign-client job stops before company details are read',async()=>{
 const f=fixture({foreign:true});await assert.rejects(readConflicts(f.db,auth,job),/IMPORT_JOB_NOT_FOUND/);
 assert.equal(f.calls.length,1);
});
test('unrecognized field names never become SQL identifiers',async()=>{
 const f=fixture({field:'country; DROP TABLE companies',status:'open'});const r=(await readConflicts(f.db,auth,job)).data[0];
 const sql=f.calls.find(c=>c.sql.includes('FROM companies')).sql;
 assert.match(sql,/NULL::text AS value/);assert.doesNotMatch(sql,/DROP TABLE/);
 assert.equal(r.resolvable,false);
});
test('missing company remains non-resolvable and is not replaced by historical values',async()=>{
 const f=fixture({missing:true,status:'open'});const r=(await readConflicts(f.db,auth,job)).data[0];
 assert.equal(r.current_value,null);assert.equal(r.company_name,null);assert.equal(r.resolvable,false);assert.match(r.blocked_reason,/no longer exists/);
});
