import {ListExports} from './ListExports';
import React,{useEffect,useRef,useState} from 'react';
import {gate1Api} from '../services/gate1Api';
import {FILTER_LABELS} from '../services/query';
import type {List,Person} from '../types';
const button='px-6 py-2.5 bg-[#18181b] border border-[#27272a] text-xs font-bold text-[#a1a1aa] hover:text-white rounded-xl disabled:opacity-30';
export function Lists(){
  const [lists,setLists]=useState<List[]>([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<List|null>(null);
  const [members,setMembers]=useState<Person[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [offset,setOffset]=useState(0);
  const sequence=useRef(0);
  const alive=useRef(true);
  const limit=50;
  useEffect(()=>{alive.current=true;void reload();return()=>{alive.current=false;sequence.current++;};},[]);
  async function reload(){setLoading(true);setError('');try{const res=await gate1Api.getLists();if(alive.current)setLists(res.data);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load lists.');}finally{if(alive.current)setLoading(false);}}
  async function inspect(list:List,pageOffset=0){
    const ticket=++sequence.current;setSelected(list);setBusy(true);setMembers([]);setError('');
    try{const res=await gate1Api.getListMembers(list.id,limit,pageOffset);if(ticket===sequence.current){setMembers(res.data);setOffset(pageOffset);}}
    catch(e){if(ticket===sequence.current)setError(e instanceof Error?e.message:'Could not load list members.');}
    finally{if(ticket===sequence.current)setBusy(false);}
  }
  const date=(value:string)=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'});
  return <div className="space-y-8 animate-in">
    <div className="flex flex-wrap gap-4 justify-between items-center"><div><h1 className="text-2xl font-bold text-white uppercase">Lead Lists</h1><p className="text-sm text-[#71717a] mt-1">Saved lists and their database members.</p></div><button className={button} disabled={loading||busy} onClick={()=>{if(selected)void inspect(selected,offset);else void reload();}}>Refresh</button></div>
    {error&&<div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">{error}</div>}
    {selected?<div className="space-y-6"><button className={button} disabled={busy} onClick={()=>{sequence.current++;setSelected(null);setMembers([]);setOffset(0);setError('');}}>Back to Lists</button><div><h2 className="text-xl font-bold text-white">{selected.name}</h2><p className="text-sm text-[#71717a] mt-1">{selected.member_count} members · Created {date(selected.created_at)} (Vietnam time)</p></div>
      <ListExports key={selected.id} listId={selected.id}/>
      {selected.metadata?.interpreted_query&&<div className="p-4 border border-[#27272a] rounded-xl text-xs text-[#a1a1aa]"><h3 className="font-bold text-white mb-2">Target at creation</h3>{selected.metadata.interpreted_query.q&&<p>Search: {selected.metadata.interpreted_query.q}</p>}{Object.entries(selected.metadata.interpreted_query.filters||{}).map(([key,value])=><p key={key}>{FILTER_LABELS[key as keyof typeof FILTER_LABELS]||'Other criterion'}: {value}</p>)}</div>}
      <div className="bg-[#0d0d0f] border border-[#1c1c1f] rounded-2xl overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-[#111114]"><tr>{['Contact','Title','Seniority','Location'].map(label=><th key={label} className="p-5 text-xs uppercase tracking-widest text-[#71717a]">{label}</th>)}</tr></thead><tbody className="text-sm divide-y divide-[#1c1c1f]">{members.map(person=><tr key={person.id}><td className="p-5 text-white font-bold">{person.full_name||'Name unavailable'}</td><td className="p-5">{person.current_title||'—'}</td><td className="p-5 text-[#a1a1aa]">{person.seniority||'—'}</td><td className="p-5 text-[#a1a1aa]">{[person.contact_city,person.contact_country].filter(Boolean).join(', ')||'—'}</td></tr>)}{!members.length&&<tr><td colSpan={4} className="py-20 text-center text-[#71717a]">{busy?'Loading members…':error?'Members could not be loaded.':'No members on this page.'}</td></tr>}</tbody></table></div><div className="p-5 border-t border-[#1c1c1f] flex justify-between items-center gap-3"><p className="text-xs text-[#71717a]">Page {Math.floor(offset/limit)+1} · {members.length} records on this page</p><div className="flex gap-2"><button className={button} disabled={busy||offset===0} onClick={()=>void inspect(selected,Math.max(0,offset-limit))}>Previous</button><button className={button} disabled={busy||members.length<limit} onClick={()=>void inspect(selected,offset+limit)}>Next</button></div></div></div>
    </div>:<div className="space-y-4">{loading?<p role="status" className="text-[#71717a] py-20">Loading lists…</p>:lists.map(list=><div key={list.id} className="p-8 bg-[#0d0d0f] border border-[#1c1c1f] rounded-2xl flex flex-wrap gap-4 justify-between items-center"><div><h2 className="font-bold text-white text-lg">{list.name}</h2><p className="text-xs text-[#71717a] mt-2">{list.member_count} members · {date(list.created_at)} (Vietnam time)</p></div><button className={button} onClick={()=>void inspect(list)}>View Members</button></div>)}{!loading&&!error&&!lists.length&&<p className="py-20 text-center text-[#71717a]">No saved lead lists.</p>}</div>}
  </div>;
}
