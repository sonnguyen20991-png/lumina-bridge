import React, {useEffect,useRef,useState} from 'react';
import {ApiError,gate1Api} from '../services/gate1Api';
import {FILTER_LABELS,normalizeQuery,requireUuid,verifyMembership} from '../services/query';
import {canWrite,useSession} from '../components/Session';
import type {InterpretData,Person,Query,SavedTarget} from '../types';

const button='px-6 py-2.5 bg-[#18181b] border border-[#27272a] text-xs font-bold text-[#a1a1aa] hover:text-white rounded-xl disabled:opacity-30';
const primary='px-6 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 disabled:opacity-30';
export function TargetBuilder({onOpenLists}:{onOpenLists:()=>void}) {
  const session=useSession();
  const write=canWrite(session.role);
  const [input,setInput]=useState('');
  const [pending,setPending]=useState<InterpretData|null>(null);
  const [draft,setDraft]=useState<Query>({q:'',filters:{}});
  const [editing,setEditing]=useState(false);
  const [executed,setExecuted]=useState<{query:Query;input:string}|null>(null);
  const [people,setPeople]=useState<Person[]>([]);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [offset,setOffset]=useState(0);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [targets,setTargets]=useState<SavedTarget[]>([]);
  const [targetError,setTargetError]=useState('');
  const [saveMode,setSaveMode]=useState<'target'|'list'|null>(null);
  const [name,setName]=useState('');
  const [writeLocked,setWriteLocked]=useState(false);
  const lock=useRef(false);
  const alive=useRef(true);
  const limit=50;
  useEffect(()=>{alive.current=true;void loadTargets();return()=>{alive.current=false;};},[]);
  async function loadTargets() {
    try {const res=await gate1Api.getSavedTargets();if(alive.current){setTargets(res.data);setTargetError('');}return res.data;}
    catch(e){if(alive.current)setTargetError(message(e));return null;}
  }
  function message(e:unknown){return e instanceof Error?e.message:'Request failed.';}
  async function interpret() {
    if(lock.current||!input.trim())return;
    lock.current=true;setBusy('interpret');setError('');setNotice('');
    try {const res=await gate1Api.interpret(input);const query=normalizeQuery(res.data);if(alive.current){setPending(res.data);setDraft(query);setEditing(false);}}
    catch(e){if(alive.current)setError(message(e));}
    finally{lock.current=false;if(alive.current)setBusy('');}
  }
  async function search(query:Query,source:string,newOffset=0) {
    if(lock.current)return;
    lock.current=true;setBusy('search');setError('');setNotice('');
    try {
      const reviewed=normalizeQuery(query);
      const res=await gate1Api.searchPeople(reviewed,limit,newOffset);
      if(!Array.isArray(res.data))throw new Error('The backend did not return search rows.');
      res.data.forEach(p=>requireUuid(p.id));
      if(alive.current){setPeople(res.data);setExecuted({query:reviewed,input:source});setOffset(newOffset);setSelected(new Set());setSaveMode(null);}
    } catch(e){if(alive.current)setError(message(e));}
    finally{lock.current=false;if(alive.current)setBusy('');}
  }
  function toggle(id:string){setSelected(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(lock.current||!executed||!write||!saveMode||!name.trim()||writeLocked)return;
    const mode=saveMode;const ids=[...selected];const snapshot={query:normalizeQuery(executed.query),input:executed.input};
    if(mode==='list'&&!ids.length)return;
    lock.current=true;setBusy('save');setError('');setNotice('');
    let savedId='';
    try {
      if(mode==='target') {
        const res=await gate1Api.saveTarget({name:name.trim(),original_input:snapshot.input,interpreted_query:snapshot.query});
        savedId=requireUuid(res.data.id);
        setSaveMode(null);
        const readback=await loadTargets();
        if(!readback?.some(t=>t.id===savedId))throw new Error('Target saved, but readback could not be verified. Refresh Saved Searches before creating another.');
        setNotice(`Target “${name.trim()}” saved and reloaded.`);
      } else {
        const res=await gate1Api.createListFromSelection({name:name.trim(),person_ids:ids,original_input:snapshot.input,interpreted_query:snapshot.query});
        savedId=requireUuid(res.data.id);
        setSaveMode(null);
        const [lists,members]=await Promise.all([gate1Api.getLists(),gate1Api.getListMembers(savedId,100,0)]);
        if(!lists.data.some(l=>l.id===savedId)||!verifyMembership(ids,members.data,res.member_count))throw new Error('List created, but selected membership could not be verified. Inspect Lead Lists before creating another.');
        setNotice(`List “${name.trim()}” saved and reloaded with ${ids.length} selected people.`);setSelected(new Set());
      }
      setName('');
    } catch(e){setError(message(e));if(savedId||(e instanceof ApiError&&e.uncertainWrite)){setWriteLocked(true);setSaveMode(null);}}
    finally{lock.current=false;if(alive.current)setBusy('');}
  }
  function openSave(mode:'target'|'list'){setSaveMode(mode);setName('');setNotice('');setError('');}
  function updateFilter(key:string,value:string){setDraft(previous=>({...previous,filters:{...previous.filters,[key]:value}}));}
  return <div className="flex flex-col gap-8 animate-in pb-20">
    <section className="space-y-4">
      <form className="relative" onSubmit={e=>{e.preventDefault();void interpret();}}>
        <span className="material-symbols-outlined absolute left-6 top-1/2 -translate-y-1/2 text-[#52525b] text-2xl" aria-hidden="true">psychology</span>
        <input aria-label="Describe who you want to find" maxLength={3000} value={input} onChange={e=>setInput(e.target.value)} disabled={!!busy} placeholder="Describe who you want to find…" className="w-full bg-[#111114] border border-[#1c1c1f] rounded-2xl pl-16 pr-48 py-6 text-lg text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"/>
        <button type="submit" disabled={!!busy||!input.trim()} className={`${primary} absolute right-4 top-1/2 -translate-y-1/2`}>{busy==='interpret'?'Interpreting…':'Interpret'}</button>
      </form>
      <p className="text-xs text-[#71717a]">Search uses text and supported filters. Persona expansion, campaign fit, outreach history, and company size are not available in this release.</p>
      {pending&&<div className="bg-[#0d0d0f] border border-indigo-500/20 rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap justify-between items-center gap-4"><div><h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Understood As</h2><p className="text-white mt-2">{editing?'Review your edited search below.':pending.understood_as}</p></div><div className="flex gap-2"><button className={button} disabled={!!busy} onClick={()=>{setPending(null);setEditing(false);}}>Cancel</button><button className={button} disabled={!!busy} onClick={()=>setEditing(!editing)}>{editing?'Close Editor':'Edit'}</button><button className={primary} disabled={!!busy} onClick={()=>void search(draft,pending.original_input)}>Apply & Search</button></div></div>
        {editing?<div className="grid grid-cols-1 md:grid-cols-3 gap-4"><label className="text-xs text-[#a1a1aa] md:col-span-3">Search text<input aria-label="Search text" maxLength={1000} value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})} className="mt-2 w-full bg-[#111114] border border-[#27272a] rounded-lg p-3 text-white"/></label>{Object.entries(FILTER_LABELS).map(([key,label])=><label key={key} className="text-xs text-[#a1a1aa]">{label}<input aria-label={label} maxLength={500} value={draft.filters[key]||''} onChange={e=>updateFilter(key,e.target.value)} className="mt-2 w-full bg-[#111114] border border-[#27272a] rounded-lg p-3 text-white"/></label>)}</div>:<div className="flex flex-wrap gap-2">{draft.q&&<span className="px-3 py-2 bg-[#111114] rounded-lg text-sm">Search: {draft.q}</span>}{Object.entries(draft.filters).filter(([,value])=>value.trim()).map(([key,value])=><span key={key} className="px-3 py-2 bg-[#111114] border border-[#1c1c1f] rounded-lg text-sm"><span className="text-[#71717a]">{FILTER_LABELS[key as keyof typeof FILTER_LABELS]}: </span>{value}</span>)}</div>}
      </div>}
    </section>
    {error&&<div role="alert" className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300">{error}</div>}
    {notice&&<div role="status" className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300">{notice}</div>}
    {writeLocked&&<div className="text-sm text-[#a1a1aa] space-x-4"><span>Saving is paused to prevent an accidental duplicate.</span><button className={button} onClick={onOpenLists}>Inspect Lead Lists</button><button className={button} onClick={()=>void loadTargets()}>Refresh Saved Searches</button></div>}
    <div className="flex flex-wrap justify-between gap-4 items-end"><div><h1 className="text-2xl font-bold text-white tracking-tight uppercase">Targeting Database</h1><p className="text-sm text-[#71717a] mt-1">{executed?`${people.length} records on this page · ${selected.size} selected`:'No targeting applied'}</p></div><div className="flex gap-3"><button disabled={!executed||!write||!!busy||writeLocked} onClick={()=>openSave('target')} className={button} title="Save these search criteria to run again.">Save Search</button><button disabled={!selected.size||!write||!!busy||writeLocked} onClick={()=>openSave('list')} className={primary} title="Save the selected contacts on this page to a lead list.">Create Lead List</button></div></div>
    {saveMode&&<form onSubmit={e=>void save(e)} className="p-6 bg-[#111114] border border-[#27272a] rounded-2xl flex flex-wrap gap-4 items-end"><label className="flex-1 text-sm">{saveMode==='target'?'Target Name':'Lead List Name'}<input required maxLength={300} autoFocus value={name} onChange={e=>setName(e.target.value)} disabled={!!busy} className="block w-full mt-2 p-3 bg-[#09090b] border border-[#27272a] rounded-xl"/></label><button type="button" disabled={!!busy} className={button} onClick={()=>setSaveMode(null)}>Cancel</button><button type="submit" disabled={!!busy||!name.trim()} className={primary}>{busy==='save'?'Saving…':'Save'}</button></form>}
    <div className="bg-[#0d0d0f] border border-[#1c1c1f] rounded-2xl overflow-hidden shadow-2xl">
      <div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead className="bg-[#111114] border-b border-[#1c1c1f]"><tr><th className="px-6 py-5"><input type="checkbox" aria-label="Select all on this page" checked={!!people.length&&selected.size===people.length} disabled={!people.length||!!busy} onChange={e=>setSelected(e.target.checked?new Set(people.map(p=>p.id)):new Set())} className="accent-indigo-600"/></th>{['Contact','Organization','Region','Department'].map(title=><th key={title} className="px-6 py-5 text-xs uppercase tracking-widest text-[#71717a]">{title}</th>)}</tr></thead><tbody className="text-sm divide-y divide-[#1c1c1f]">{people.map(p=><tr key={p.id} className={selected.has(p.id)?'bg-indigo-600/5':'hover:bg-[#18181b]'}><td className="px-6 py-5"><input type="checkbox" aria-label={`Select ${p.full_name||'unnamed contact'}`} checked={selected.has(p.id)} disabled={!!busy} onChange={()=>toggle(p.id)} className="accent-indigo-600"/></td><td className="px-6 py-5"><div className="font-bold text-white">{p.full_name||'Name unavailable'}</div><div className="text-xs text-[#71717a] mt-1">{p.current_title||'—'}</div><div className="text-xs text-[#a1a1aa] mt-1">{p.primary_email||''}</div></td><td className="px-6 py-5"><div>{p.company_name||'—'}</div><div className="text-xs text-[#71717a] mt-1">{p.company_industry||''}</div></td><td className="px-6 py-5 text-[#a1a1aa]">{[p.contact_city,p.contact_country].filter(Boolean).join(', ')||'—'}</td><td className="px-6 py-5 text-[#a1a1aa]">{p.department||'—'}</td></tr>)}{!people.length&&<tr><td colSpan={5} className="py-24 text-center text-[#71717a]">{busy==='search'?'Searching…':executed?'No matching records.':'Review a query, then apply it to search.'}</td></tr>}</tbody></table></div>
      <div className="px-6 py-4 border-t border-[#1c1c1f] flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[#71717a]">{executed?`Page ${Math.floor(offset/limit)+1} · ${people.length} records on this page`:'Search results'} · Selection applies to this page only</p><div className="flex gap-2"><button className={button} disabled={!executed||offset===0||!!busy} onClick={()=>executed&&void search(executed.query,executed.input,Math.max(0,offset-limit))}>Previous</button><button className={button} disabled={!executed||people.length<limit||!!busy} onClick={()=>executed&&void search(executed.query,executed.input,offset+limit)}>Next</button></div></div>
    </div>
    <section className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-white">Saved Searches</h2><button className={button} disabled={!!busy} onClick={()=>void loadTargets()}>Refresh Saved Searches</button></div>{targetError&&<p role="alert" className="text-rose-300 text-sm">{targetError}</p>}{targets.length===0&&!targetError&&<p className="text-sm text-[#71717a]">No saved searches.</p>}{targets.map(target=><button key={target.id} disabled={!!busy} onClick={()=>{try {setDraft(normalizeQuery(target.interpreted_query));setPending({original_input:target.original_input||'',q:target.interpreted_query.q,filters:target.interpreted_query.filters,understood_as:target.name,interpreter_version:''});setEditing(true);setInput(target.original_input||'');} catch(e){setError(message(e));}}} className="block w-full text-left p-5 bg-[#111114] border border-[#1c1c1f] rounded-xl hover:border-indigo-500/40"><span className="text-white font-bold">{target.name}</span><span className="block text-xs text-[#71717a] mt-1">Review this saved search</span></button>)}</section>
  </div>;
}
