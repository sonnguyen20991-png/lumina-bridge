import React,{useEffect,useRef,useState} from 'react';
import {canWrite,useSession} from '../components/Session';
import {ApiError} from '../services/gate1Api';
import {exportApi,type ExportJob} from '../services/exportApi';
const button='px-4 py-2 border border-[#27272a] rounded-xl text-sm disabled:opacity-30 hover:text-white';
export function ListExports({listId}:{listId:string}){
 const session=useSession();const key=`lumina-export-pending:${session.principal_id}:${session.client_id}:${listId}`;
 const [jobs,setJobs]=useState<ExportJob[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [locked,setLocked]=useState(()=>{try{return !!sessionStorage.getItem(key);}catch{return true;}});
 const active=useRef(true),inFlight=useRef(false);
 useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;};},[listId]);
 async function refresh(){setLoading(true);try{const all=await exportApi.history();if(active.current)setJobs(all.filter(j=>j.list_id===listId));}catch(e){if(active.current)setError(e instanceof Error?e.message:'History failed.');}finally{if(active.current)setLoading(false);}}
 async function download(job:ExportJob){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await exportApi.download(job);}catch(e){if(active.current)setError(e instanceof Error?e.message:'Download failed.');}finally{inFlight.current=false;if(active.current)setBusy(false);}}
 async function create(format:'csv'|'xlsx'){
  if(inFlight.current||locked||!canWrite(session.role))return;inFlight.current=true;setBusy(true);setError('');
  try{
   sessionStorage.setItem(key,JSON.stringify({format,started_at:new Date().toISOString()}));setLocked(true);
   const job=await exportApi.create(listId,format);
   sessionStorage.removeItem(key);if(active.current){setLocked(false);setJobs(old=>[job,...old.filter(j=>j.id!==job.id)]);}
   await exportApi.download(job);
  }catch(e){if(e instanceof ApiError&&!e.uncertainWrite){try{sessionStorage.removeItem(key);}catch{}if(active.current)setLocked(false);}if(active.current)setError(e instanceof Error?e.message:'Export failed.');}
  finally{inFlight.current=false;if(active.current)setBusy(false);}
 }
 return <section className="space-y-3 p-5 border border-[#27272a] rounded-xl"><h3 className="font-bold text-white">Export contacts</h3><p className="text-sm text-[#a1a1aa]">Export the whole list, including members on other pages. CSV and Excel support up to 25,000 contacts. Downloads use current database values.</p>
 {canWrite(session.role)?<div className="flex gap-3"><button className={button} disabled={busy||locked} onClick={()=>void create('csv')}>Export CSV</button><button className={button} disabled={busy||locked} onClick={()=>void create('xlsx')}>Export Excel</button></div>:<p className="text-sm text-[#a1a1aa]">Your viewer role cannot create exports. You can download existing exports for this client.</p>}
 {locked&&<div className="text-sm text-amber-200 space-y-2"><p>An export submission may be pending. Refresh history and check recent exports before creating another.</p><button className={button} disabled={busy||loading} onClick={()=>{try{sessionStorage.removeItem(key);setLocked(false);}catch{setError('Browser storage is unavailable.');}}}>I reviewed history — enable a new export</button></div>}
 {error&&<p role="alert" className="text-rose-300 text-sm">{error}</p>}
 <div className="flex justify-between items-center"><h4 className="text-sm font-bold">Export history for this list</h4><button className={button} disabled={busy||loading} onClick={()=>void refresh()}>Refresh exports</button></div>
 {loading&&<p role="status" className="text-sm">Loading exports…</p>}
 {jobs.map(job=><div key={job.id} className="flex flex-wrap justify-between gap-3 border-t border-[#27272a] pt-3"><div className="text-xs space-y-1"><p>{job.format.toUpperCase()} · {job.row_count} contacts · {job.status}</p><p>{new Date(job.created_at).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'})} (Vietnam time)</p><p>Export ID: {job.id}</p></div><button className={button} disabled={busy||!['ready','completed'].includes(job.status)} onClick={()=>void download(job)}>Download {job.format.toUpperCase()}</button></div>)}
 {!loading&&!jobs.length&&<p className="text-sm text-[#71717a]">No exports found for this list.</p>}
 </section>;
}
