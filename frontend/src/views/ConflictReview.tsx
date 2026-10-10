import React,{useEffect,useRef,useState} from 'react';
import {conflictApi,type Conflict,type ReviewPage} from '../services/conflictApi';
const button='px-4 py-3 rounded-xl border border-[#27272a] text-sm text-white disabled:opacity-40 hover:bg-[#18181b]';
const value=(s:string|null)=>s??'—';
export function ConflictReview({jobId,onBack}:{jobId:string;onBack:()=>void}){
 const [page,setPage]=useState<ReviewPage|null>(null),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [choice,setChoice]=useState<{conflict:Conflict;decision:'keep_existing'|'accept_incoming'}|null>(null);
 const [note,setNote]=useState(''),[ack,setAck]=useState(false),[uncertain,setUncertain]=useState(false);
 const writeLock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setPage(null);setChoice(null);setError('');
  conflictApi.list(jobId,offset,controller.signal).then(p=>{if(!controller.signal.aborted){setPage(p);setUncertain(false);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[jobId,offset,refresh]);
 async function decide(){
  if(!choice||!ack||!note.trim()||writeLock.current||uncertain)return;
  writeLock.current=true;setBusy(true);setError('');setNotice('');
  try{await conflictApi.resolve(jobId,choice.conflict,choice.decision,note);if(mounted.current){setNotice('Decision recorded. Other conflicts remain unchanged.');setRefresh(n=>n+1);}}
  catch(e){if(mounted.current){setError(e instanceof Error?e.message:'Review failed.');setUncertain(true);setChoice(null);}}
  finally{writeLock.current=false;if(mounted.current)setBusy(false);}
 }
 return <div className="space-y-6"><button className={button} disabled={busy} onClick={onBack}>Back to import</button><h1 className="text-2xl font-bold text-white">Review import conflicts</h1><p className="font-mono text-xs break-all text-[#71717a]">{jobId}</p><p className="text-sm text-[#a1a1aa]">Company values are shared across the contact database. Review the current value as well as the values recorded at import. Each decision resolves one conflict.</p>
 <button className={button} disabled={busy||loading} onClick={()=>setRefresh(n=>n+1)}>Refresh conflicts</button>
 {error&&<p role="alert" className="text-rose-300">{error}</p>}{notice&&<p role="status" className="text-emerald-300">{notice}</p>}
 {loading&&<p role="status">Loading conflicts…</p>}
 {page&&!page.can_resolve&&<p className="text-sm text-amber-200">You can review these records. Shared-data resolution requires a designated reviewer with an owner or admin role.</p>}
 {page?.data.length===0&&<p>No conflict records on this page.</p>}
 {page?.data.map(c=><section key={c.id} className="p-6 rounded-2xl border border-[#27272a] bg-[#111114] space-y-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg text-white font-semibold">{c.company_name||c.entity_type} · {c.field_name}</h2><span className="text-xs text-indigo-300">{c.status}</span></div><p className="text-xs text-[#71717a]">Source: {c.source_name||'—'}</p><dl className="grid md:grid-cols-3 gap-4 text-sm">{[['Existing at import',c.existing_value],['Incoming from file',c.incoming_value],['Current canonical value',c.current_value]].map(([label,v])=><div key={label} className="min-w-0"><dt className="text-[#71717a] mb-2">{label}</dt><dd className="whitespace-pre-wrap break-words">{value(v)}</dd></div>)}</dl>{c.protected&&<p className="text-sm text-amber-200">The current field is protected. Accepting incoming replaces that protected value with a new protected manual decision.</p>}{c.blocked_reason&&<p className="text-sm text-amber-200">{c.blocked_reason}</p>}{c.status==='open'&&c.resolvable&&page.can_resolve&&<div className="flex flex-wrap gap-3"><button className={button} disabled={busy||uncertain||loading} onClick={()=>{setChoice({conflict:c,decision:'keep_existing'});setNote('');setAck(false);}}>Keep current value</button><button className={button+' bg-indigo-600'} disabled={busy||uncertain||loading} onClick={()=>{setChoice({conflict:c,decision:'accept_incoming'});setNote('');setAck(false);}}>Accept incoming</button></div>}{c.resolution_note&&<p className="text-sm text-[#a1a1aa]">Review note: {c.resolution_note}</p>}</section>)}
 {choice&&<section aria-labelledby="decision-heading" className="p-6 border border-indigo-500 rounded-2xl space-y-4"><h2 id="decision-heading" className="font-semibold text-white">{choice.decision==='accept_incoming'?'Accept incoming value':'Keep current value'}: {choice.conflict.company_name} · {choice.conflict.field_name}</h2><p className="text-sm">{choice.decision==='accept_incoming'?'This changes the shared company value and protects your manual decision from later imports.':'This closes this conflict and keeps the current value and provenance. It does not add protection against future imports.'}</p><p className="text-sm break-words">Value after decision: {value(choice.decision==='accept_incoming'?choice.conflict.incoming_value:choice.conflict.current_value)}</p><label className="block text-sm">Reason for decision<textarea autoFocus className="block w-full mt-2 bg-[#18181b] rounded-xl border border-[#27272a] p-3" maxLength={2000} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label><label className="flex gap-3 text-sm"><input type="checkbox" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>I understand this decision concerns shared company data and will be recorded with my identity.</label><div className="flex gap-3"><button className={button+' bg-indigo-600'} disabled={busy||!ack||!note.trim()||uncertain} onClick={()=>void decide()}>{busy?'Recording…':'Record decision'}</button><button className={button} disabled={busy} onClick={()=>setChoice(null)}>Cancel</button></div></section>}
 {page&&<div className="flex gap-3"><button className={button} disabled={busy||loading||offset===0} onClick={()=>setOffset(n=>Math.max(0,n-50))}>Previous</button><button className={button} disabled={busy||loading||!page.pagination.has_more} onClick={()=>setOffset(n=>n+50)}>Next</button></div>}
 </div>;
}
