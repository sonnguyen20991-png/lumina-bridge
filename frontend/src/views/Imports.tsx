import React,{useEffect,useRef,useState} from 'react';
import {canWrite,useSession} from '../components/Session';
import {ApiError} from '../services/gate1Api';
import {completionLabel,importApi,readPending,terminal,validateFile,type ImportJob,type PendingImport} from '../services/importApi';
import {ConflictReview} from './ConflictReview';
import {requireUuid} from '../services/query';
const button='px-5 py-3 rounded-xl border border-[#27272a] text-sm text-white disabled:opacity-40 hover:bg-[#18181b]';
const primary=button+' bg-indigo-600 border-indigo-500 hover:bg-indigo-500';
const input='block w-full mt-2 bg-[#111114] border border-[#27272a] rounded-xl p-3 text-sm text-white';
const panel='p-6 md:p-8 rounded-2xl border border-[#1c1c1f] bg-[#0d0d0f]';
const message=(e:unknown)=>e instanceof Error?e.message:'Import request failed.';
async function fingerprint(file:File) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function Imports({onOpenSearch}:{onOpenSearch:()=>void}) {
  const session=useSession();
  const [reviewJob,setReviewJob]=useState<string|null>(null);
  const storageKey=`lumina.import.v1.${session.principal_id}.${session.client_id}`;
  const [pending,setPending]=useState<PendingImport|null>(()=>readPending(localStorage,storageKey));
  const [file,setFile]=useState<File|null>(null);
  const [source,setSource]=useState('File upload');
  const [job,setJob]=useState<ImportJob|null>(null);
  const [jobInput,setJobInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [auto,setAuto]=useState(true);
  const [uncertain,setUncertain]=useState(false);
  const [safeToDiscard,setSafeToDiscard]=useState(false);
  const lock=useRef(false);
  const mounted=useRef(true);
  const pendingRef=useRef(pending);pendingRef.current=pending;
  const writable=canWrite(session.role);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  function remember(value:PendingImport) {
    // Persist before POST so a refresh cannot silently lose the submission key.
    localStorage.setItem(storageKey,JSON.stringify(value));
    pendingRef.current=value;setPending(value);
  }
  useEffect(()=>{
    if(!pending?.jobId||!auto)return;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
    const started=Date.now();
    const poll=async()=>{
      try {
        const value=await importApi.getJob(pending.jobId!,session.client_id,AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]));
        if(stopped)return;
        setJob(value);setError('');
        if(!terminal(value.status)&&Date.now()-started<600000)timer=setTimeout(()=>void poll(),3000);
        else if(!terminal(value.status)){setAuto(false);setError('Automatic checks paused after 10 minutes. Use Refresh Status to continue.');}
      }catch(e){if(!stopped){setError(message(e));setAuto(false);}}
    };
    void poll();return()=>{stopped=true;controller.abort();if(timer)clearTimeout(timer);};
  },[pending?.jobId,session.client_id,auto]);
  async function refresh() {
    if(lock.current)return;
    const id=pending?.jobId||job?.id;if(!id)return;
    lock.current=true;setBusy(true);setError('');
    try {const value=await importApi.getJob(id,session.client_id);if(mounted.current){setJob(value);setAuto(!terminal(value.status));}}
    catch(e){if(mounted.current)setError(message(e));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function submit() {
    if(lock.current||!writable||!file)return;
    lock.current=true;setBusy(true);setError('');setSafeToDiscard(false);
    let sent=false;
    try {
      validateFile(file);
      const digest=await fingerprint(file);
      let record=pendingRef.current;
      if(record?.jobId)throw new Error('This submission already has a job. Check its status.');
      if(record) {
        if(record.sha256!==digest||record.size!==file.size)throw new Error('Choose the exact same file to check this submission. Its contents must match.');
      }else {
        if(!source.trim()||source.trim().length>200)throw new Error('Enter a source name of 1–200 characters.');
        record={version:1,key:`lumina-ui-${crypto.randomUUID()}`,filename:file.name,size:file.size,sha256:digest,source:source.trim()};
        remember(record);
      }
      sent=true;
      const receipt=await importApi.upload(file,record);
      const updated={...record,jobId:receipt.import_job_id,mapping:receipt.file_import?.header_mapping};
      // A receipt remains visible in memory if browser storage becomes unavailable.
      pendingRef.current=updated;
      if(mounted.current){setPending(updated);setUncertain(false);setAuto(true);}
      try{localStorage.setItem(storageKey,JSON.stringify(updated));}catch{if(mounted.current)setError('Job accepted, but browser storage failed. Copy the job ID before leaving this page.');}
    }catch(e){if(mounted.current){setError(message(e));setUncertain(sent&&(e instanceof ApiError?e.uncertainWrite:true));setSafeToDiscard(e instanceof ApiError&&e.status===400&&!e.uncertainWrite);}}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function openJob() {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      const id=requireUuid(jobInput.trim());
      const value=await importApi.getJob(id,session.client_id);
      if(mounted.current){setJob(value);setAuto(false);}
    }catch(e){if(mounted.current)setError(message(e));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  function newImport() {
    if(!job||!terminal(job.status)||busy)return;
    try{localStorage.removeItem(storageKey);}catch(e){setError(message(e));return;}
    pendingRef.current=null;setPending(null);setFile(null);setJob(null);setError('');setUncertain(false);setAuto(true);
  }
  function discardRejected() {
    if(!safeToDiscard||busy)return;
    try{localStorage.removeItem(storageKey);}catch(e){setError(message(e));return;}
    pendingRef.current=null;setPending(null);setFile(null);setSafeToDiscard(false);setUncertain(false);setError('');
  }
  const activeId=pending?.jobId||job?.id;
  const shownJob=job&&(!pending?.jobId||job.id===pending.jobId)?job:null;
  const mapping=shownJob?.metadata?.file_import?.header_mapping||pending?.mapping||[];
  const progress=shownJob?(shownJob.total_rows?Math.round(shownJob.processed_rows/shownJob.total_rows*100):0):0;
  if(reviewJob)return <ConflictReview jobId={reviewJob} onBack={()=>setReviewJob(null)}/>;
  return <div className="space-y-7 max-w-5xl">
    <header><p className="text-xs tracking-widest uppercase text-indigo-400 mb-3">Database / Import</p><h1 className="text-3xl font-bold text-white">Import contacts</h1><p className="mt-3 text-sm text-[#a1a1aa]">Upload a CSV or XLSX, follow processing, then find your contacts in Target Builder.</p></header>
    {error&&<div role="alert" className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-200">{error}</div>}
    {!writable&&<p className="text-sm text-amber-200">Your role can inspect jobs but cannot upload contacts.</p>}
    <section className={panel+' space-y-5'} aria-labelledby="upload-heading">
      <h2 id="upload-heading" className="text-lg font-semibold text-white">{pending?'Current submission':'Choose a file'}</h2>
      <p className="text-sm text-[#a1a1aa]">CSV or XLSX · Up to 10 MiB and 5,000 rows. Files above 50 rows process in the background.</p>
      {!activeId&&<><label className="block text-sm">Contact file<input key={pending?.key||'new'} className={input} type="file" accept=".csv,.xlsx" disabled={busy||!writable} onChange={e=>{setFile(e.target.files?.[0]||null);setError('');}}/></label><label className="block text-sm">Source name<input className={input} value={pending?.source??source} maxLength={200} disabled={busy||!!pending||!writable} onChange={e=>setSource(e.target.value)}/></label></>}
      {pending&&<div className="text-xs text-[#a1a1aa] space-y-2 break-all"><p>File: {pending.filename}</p><p>Submission key: <span className="font-mono">{pending.key}</span></p></div>}
      {!activeId&&<><button className={primary} disabled={busy||!file||!writable} onClick={()=>void submit()}>{busy?'Submitting…':pending?'Check submission with same file':'Upload contacts'}</button>{pending&&<p className="text-sm text-amber-200">{uncertain?'The upload response was lost.':'This submission is retained until its outcome is known.'} Reselect the same file to check using its original key. This does not create a new submission.</p>}</>}
      {safeToDiscard&&<button className={button} disabled={busy} onClick={discardRejected}>Choose a different file after validation failure</button>}
      <p className="text-xs text-[#71717a]">Uploads update the shared contact database. This does not automatically create a lead list.</p>
    </section>
    {activeId&&<section className={panel+' space-y-5'} aria-labelledby="job-heading">
      <div className="flex flex-wrap justify-between items-start gap-4"><div><h2 id="job-heading" className="text-lg font-semibold text-white">{shownJob?completionLabel(shownJob):'Checking import status…'}</h2><p className="text-xs text-[#71717a] font-mono mt-2 break-all">{activeId}</p></div><button className={button} disabled={busy} onClick={()=>void refresh()}>Refresh Status</button></div>
      {shownJob&&<><div role="status" aria-live="polite" className="text-sm text-[#a1a1aa]">{shownJob.processed_rows} of {shownJob.total_rows} rows processed · {progress}%</div><progress className="w-full h-2 accent-indigo-500" value={shownJob.processed_rows} max={shownJob.total_rows||1} aria-label="Import progress"/>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">{[['Inserted',shownJob.inserted_rows],['Updated',shownJob.updated_rows],['Duplicates',shownJob.duplicate_rows],['Rejected',shownJob.rejected_rows],['Suppressed',shownJob.suppressed_rows],['Rows with conflicts at import',shownJob.conflict_rows]].map(([label,count])=><div key={label} className="p-4 bg-[#111114] rounded-xl border border-[#1c1c1f]"><dt className="text-xs text-[#71717a]">{label}</dt><dd className="mt-2 text-2xl font-semibold text-white tabular-nums">{count}</dd></div>)}</dl>
      <p className="text-xs text-[#71717a]">Conflict counts overlap inserted or updated rows; do not add them to the total. Conflicts can involve company fields.</p>
      {shownJob.rejected_rows>0&&<p className="text-sm text-amber-200">{shownJob.rejected_rows} rows were rejected. A completed job does not mean every contact was saved. Review the source headers and import evidence before resubmitting.</p>}
      {shownJob.conflict_rows>0&&<p className="text-sm text-amber-200">{shownJob.conflict_rows} rows had conflicts during this import. This historical count stays unchanged after review. Review the conflict records before deciding which company values to retain.</p>}
      {shownJob.conflict_rows>0&&<button className={button} onClick={()=>setReviewJob(shownJob.id)}>Review conflicts</button>}
      {terminal(shownJob.status)&&<div className="flex gap-3 flex-wrap"><button className={primary} onClick={onOpenSearch}>Find imported contacts</button><button className={button} disabled={busy} onClick={newImport}>Start another import</button></div>}</>}
    </section>}
    {mapping.length>0&&<section className={panel}><h2 className="text-lg font-semibold text-white mb-4">Header mapping used</h2><p className="text-xs text-[#71717a] mb-4">Reported by the backend after upload. This is not a pre-import mapping preview.</p><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-[#71717a]"><th scope="col" className="py-3">File column</th><th scope="col">Mapped field</th></tr></thead><tbody>{mapping.map((m,i)=><tr key={`${m.original}-${i}`} className="border-t border-[#1c1c1f]"><td className="py-3 pr-4">{m.original}</td><td className="text-indigo-300 font-mono text-xs">{m.target}</td></tr>)}</tbody></table></div><p className="text-xs text-amber-200 mt-4">A mapped header does not guarantee its field is supported by every import stage. Verify contact details after processing.</p></section>}
    {!pending&&<section className={panel+' space-y-4'}><h2 className="text-lg font-semibold text-white">Check an existing job</h2><label className="block text-sm">Import job ID<input className={input} value={jobInput} onChange={e=>setJobInput(e.target.value)} placeholder="Paste an import job UUID" disabled={busy}/></label><button className={button} disabled={busy||!jobInput.trim()} onClick={()=>void openJob()}>Check Job</button></section>}
    <p className="text-xs text-[#71717a]">The latest submission is remembered in this browser for this account and client. Files and contact rows are not saved in browser storage. Keep its job ID for access from another browser.</p>
  </div>;
}
