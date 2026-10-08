import test from 'node:test';
import assert from 'node:assert/strict';
import {canResolve,versionOf,resolveConflict,readConflicts} from '../conflict-routes.js';
const principal='d6adcdbb-df25-4457-870f-5c093baf8771',job='851da0c4-705d-4772-a65d-960bdb531e69',id='e20e466c-6eca-4188-b4cc-9e3c5e7fae0e';
process.env.LUMINA_SHARED_DATA_REVIEWERS=principal;
const auth={principalId:principal,clientId:'777b940f-dbc1-44b3-b569-a89661bde598',role:'owner',provider:'iap'};
function fixture(options={}){
 let c={id,entity_type:'company',entity_id:'939db589-b321-4b72-909e-da5b3ce719cc',field_name:'staff_count_range',existing_value:'11 - 50 employees',incoming_value:'51 - 200 employees',status:'open',conflict_type:'field_value_disagreement',source_name:'Pilot',evidence:{incoming_priority:50},import_job_id:job,raw_source_row_id:null};
 let company={id:c.entity_id,canonical_name:'Example company',value:'11 - 50 employees',updated_at:'2026-10-01T00:00:00Z'};
 let state={id:'117b834f-2d5a-4723-8b4c-ae9bf2e78abd',current_value:company.value,source_name:'Pilot',source_priority:50,is_protected:false,current_observation_id:null,updated_at:company.updated_at};
 const initial=JSON.stringify({c,company,state});const calls=[];let releases=0;
 const result=rows=>({rows,rowCount:rows.length});
 const db={async query(sql,p=[]){calls.push({sql,p});
  if(sql==='ROLLBACK'){const old=JSON.parse(initial);c=old.c;company=old.company;state=old.state;return result([]);}
  if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('SET LOCAL')||sql.includes('pg_advisory'))return result([]);
  if(sql.includes('SELECT cm.role'))return result(options.revoked?[]:[{role:'owner'}]);
  if(sql.includes('JOIN import_jobs j')){assert.equal(p[2],auth.clientId);return result(options.crossClient?[]:[{...c}]);}
  if(sql.includes('FROM companies'))return result([{...company}]);
  if(sql.includes('FROM canonical_field_state'))return result(options.missingState?[]:[{...state}]);
  if(sql.includes('SELECT * FROM conflicts WHERE id')){if(options.stale)company.value='Changed by another writer';if(options.closed)c.status='resolved_existing';return result([{...c}]);}
  if(sql.startsWith('INSERT INTO field_observations'))return result([{id:'a38105fd-9fef-403f-a9bd-34089fdba193'}]);
  if(sql.startsWith('UPDATE companies')){company.value=p[1];return result([]);}
  if(sql.startsWith('UPDATE canonical_field_state')){state.current_value=JSON.parse(p[1]);state.is_protected=true;return result([]);}
  if(sql.startsWith('UPDATE conflicts')){c.status=p[1];return result([]);}
  if(sql.includes('INSERT INTO audit_events')){if(options.auditFails)throw new Error('Audit unavailable');return result([]);}
  if(sql.startsWith('SELECT id,status FROM import_jobs'))return result(options.crossClient?[]:[{id:job,status:'completed'}]);
  if(sql.startsWith('SELECT * FROM conflicts WHERE import_job_id'))return result([{...c}]);
  throw new Error('Unexpected query: '+sql);
 },release(){releases++;}};
 return {pool:{connect:async()=>db},db,calls,get c(){return c;},get company(){return company;},get state(){return state;},get releases(){return releases;},body(decision='accept_incoming'){return {decision,version:versionOf(c,company,state),note:'Reviewed source evidence',acknowledge_shared:true};}};
}
const writes=f=>f.calls.filter(x=>/^(UPDATE|INSERT)/.test(x.sql));
test('shared-data authority requires verified IAP identity, owner/admin and explicit designation',()=>{
 assert.equal(canResolve(auth),true);for(const a of [{...auth,role:'member'},{...auth,provider:'staging-header'},{...auth,principalId:job}])assert.equal(canResolve(a),false);
 assert.equal(canResolve(auth,''),false);
});
test('accept incoming updates company and protected provenance and records actor in one transaction',async()=>{
 const f=fixture();const result=await resolveConflict(f.pool,auth,job,id,{...f.body(),principalId:'spoofed',incoming_value:'spoofed'});
 assert.equal(result.data.status,'resolved_incoming');assert.equal(f.company.value,'51 - 200 employees');assert.equal(f.state.current_value,f.company.value);assert.equal(f.state.is_protected,true);
 const audit=f.calls.find(x=>x.sql.includes('INSERT INTO audit_events'));assert.equal(audit.p[0],principal);assert.equal(JSON.parse(audit.p[3]).after,'51 - 200 employees');
 const obs=f.calls.find(x=>x.sql.startsWith('INSERT INTO field_observations'));assert.equal(obs.p[6],100);assert.equal(obs.p[7],'accepted');
 assert.equal(f.calls.at(-1).sql,'COMMIT');assert.equal(f.releases,1);
 const company=f.calls.findIndex(x=>x.sql.includes('FROM companies')),advisory=f.calls.findIndex(x=>x.sql.includes('pg_advisory')),state=f.calls.findIndex(x=>x.sql.includes('FROM canonical_field_state'));
 assert.ok(company<advisory&&advisory<state);
});
test('keep current closes conflict but preserves company and provenance',async()=>{
 const f=fixture();await resolveConflict(f.pool,auth,job,id,f.body('keep_existing'));
 assert.equal(f.c.status,'resolved_existing');assert.equal(f.company.value,'11 - 50 employees');assert.equal(f.state.is_protected,false);
 assert.equal(f.calls.some(x=>x.sql.startsWith('UPDATE companies')||x.sql.startsWith('UPDATE canonical_field_state')),false);
 assert.equal(f.calls.find(x=>x.sql.startsWith('INSERT INTO field_observations')).p[7],'kept_existing');
});
test('stale token is rejected before any write',async()=>{
 const f=fixture();const body=f.body();body.version='0'.repeat(64);
 await assert.rejects(resolveConflict(f.pool,auth,job,id,body),/REVIEW_STALE/);assert.equal(writes(f).length,0);assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('already-resolved conflict cannot be applied twice',async()=>{
 const f=fixture({closed:true});await assert.rejects(resolveConflict(f.pool,auth,job,id,f.body()),/ALREADY_RESOLVED/);assert.equal(writes(f).length,0);
});
test('cross-client job conflict remains inaccessible',async()=>{
 const f=fixture({crossClient:true});await assert.rejects(resolveConflict(f.pool,auth,job,id,f.body()),/NOT_FOUND/);assert.equal(writes(f).length,0);
 await assert.rejects(readConflicts(f.db,auth,job),/NOT_FOUND/);
});
test('revoked membership and missing provenance stop resolution',async()=>{
 for(const option of [{revoked:true},{missingState:true}]){const f=fixture(option);await assert.rejects(resolveConflict(f.pool,auth,job,id,f.body()));assert.equal(writes(f).length,0);}
});
test('audit failure rolls back canonical value, provenance and conflict status',async()=>{
 const f=fixture({auditFails:true});await assert.rejects(resolveConflict(f.pool,auth,job,id,f.body()),/Audit unavailable/);
 assert.equal(f.company.value,'11 - 50 employees');assert.equal(f.state.is_protected,false);assert.equal(f.c.status,'open');assert.equal(f.calls.at(-1).sql,'ROLLBACK');assert.equal(f.releases,1);
});
test('missing reason, shared-data acknowledgement, or invalid decision never opens transaction',async()=>{
 for(const change of [{note:''},{acknowledge_shared:false},{decision:'delete_company'}]){const f=fixture();await assert.rejects(resolveConflict(f.pool,auth,job,id,{...f.body(),...change}),/INVALID_REVIEW/);assert.equal(f.calls.length,0);}
});
test('read-only review reports current value and capability without writes',async()=>{
 const f=fixture();const page=await readConflicts(f.db,{...auth,role:'viewer'},job);assert.equal(page.can_resolve,false);assert.equal(page.data[0].current_value,f.company.value);assert.equal(page.data[0].version,f.body().version);assert.equal(writes(f).length,0);
});
