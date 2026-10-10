import React,{useEffect,useRef,useState} from 'react';
import {canWrite,useSession} from '../components/Session';
import {ApiError,gate1Api} from '../services/gate1Api';
import {requireUuid} from '../services/query';
import type {Icp} from '../types';

const button='px-4 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-sm disabled:opacity-30';

export function IcpPanel({
  activeIcp,
  selected,
  busy,
  onBusy,
  onFilter,
  onChanged,
}:{
  activeIcp:string;
  selected:string[];
  busy:boolean;
  onBusy:(value:boolean)=>void;
  onFilter:(id:string,name:string)=>void;
  onChanged:()=>void;
}){
  const session=useSession();
  const writable=canWrite(session.role);

  const [icps,setIcps]=useState<Icp[]>([]);
  const [chosen,setChosen]=useState('');
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [working,setWorking]=useState(false);
  const [createUncertain,setCreateUncertain]=useState(false);

  const lock=useRef(false);
  const alive=useRef(true);

  useEffect(()=>{
    alive.current=true;
    void refresh();
    return()=>{alive.current=false;};
  },[]);

  async function refresh(){
    try{
      const res=await gate1Api.getIcps();
      res.data.forEach(icp=>requireUuid(icp.id));

      if(alive.current){
        setIcps(res.data);
        setError('');
      }
    }catch(e){
      if(alive.current){
        setError(e instanceof Error?e.message:'Could not load ICPs.');
      }
    }
  }

  async function create(){
    if(lock.current||busy||!writable||createUncertain||!name.trim())return;

    lock.current=true;
    setWorking(true);
    setError('');
    setNotice('');
    onBusy(true);

    try{
      const res=await gate1Api.createIcp({
        id:crypto.randomUUID(),
        name:name.trim(),
        description:description.trim(),
      });

      requireUuid(res.data.id);

      if(alive.current){
        setIcps(current=>[...current,res.data]);
        setChosen(res.data.id);
        setName('');
        setDescription('');
        setNotice('ICP created. Select contacts and add this tag when they fit.');
      }
    }catch(e){
      if(alive.current){
        setError(e instanceof Error?e.message:'Create failed.');

        if(e instanceof ApiError&&e.uncertainWrite){
          setCreateUncertain(true);
        }
      }
    }finally{
      lock.current=false;
      onBusy(false);

      if(alive.current){
        setWorking(false);
      }
    }
  }

  async function change(action:'add'|'remove'){
    if(lock.current||busy||!writable||!chosen||!selected.length)return;

    const ids=[...selected];

    lock.current=true;
    setWorking(true);
    onBusy(true);
    setError('');
    setNotice('');

    let changed=false;

    try{
      const res=await gate1Api.assignIcp(chosen,ids,action);
      const tagged=new Set(res.data.tagged_person_ids);

      if(
        action==='add'
          ? ids.some(id=>!tagged.has(id))
          : ids.some(id=>tagged.has(id))
      ){
        throw new Error('Tag readback did not match. Refresh the search before continuing.');
      }

      changed=true;

      if(alive.current){
        setNotice(
          `${action==='add'?'Added':'Removed'} ICP tag for ${res.data.changed_count} contacts. Other ICP tags stay in place.`
        );

        await refresh();
      }
    }catch(e){
      if(alive.current){
        setError(e instanceof Error?e.message:'Tag change failed.');
      }
    }finally{
      lock.current=false;
      onBusy(false);

      if(alive.current){
        setWorking(false);
      }
    }

    if(changed&&alive.current){
      onChanged();
    }
  }

  const chosenIcp=icps.find(icp=>icp.id===chosen);

  return (
    <section className="lumina-icp-panel bg-[#111114] border border-[#27272a] rounded-xl p-5 space-y-4">
      <h2 className="text-lg font-bold">
        ICP tags
      </h2>

      <p className="text-sm text-[#a1a1aa]">
        Assign tags when a contact fits your ideal customer profile. Contacts
        can have several tags. Tags belong to this client; assignment is manual.
      </p>

      {activeIcp&&(
        <p className="text-sm text-indigo-300">
          Search draft ICP:{' '}
          {icps.find(icp=>icp.id===activeIcp)?.name||'Saved ICP'}.
          {' '}Apply the search to refresh results.
        </p>
      )}

      {error&&(
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}

      {notice&&(
        <p role="status" className="text-emerald-300">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label>
          ICP{' '}
          <select
            aria-label="Choose ICP"
            className={`${button} ml-2`}
            disabled={busy||working}
            value={chosen}
            onChange={event=>setChosen(event.target.value)}
          >
            <option value="">
              Choose an ICP
            </option>

            {icps.map(icp=>(
              <option key={icp.id} value={icp.id}>
                {icp.name}
                {icp.member_count!==undefined?` (${icp.member_count})`:''}
              </option>
            ))}
          </select>
        </label>

        <button
          className={button}
          disabled={busy||working||!chosen}
          onClick={()=>onFilter(chosen,chosenIcp?.name||'ICP')}
        >
          Use in search
        </button>

        <button
          className={button}
          disabled={busy||working}
          onClick={()=>onFilter('','')}
        >
          Clear ICP filter
        </button>

        <button
          className={button}
          disabled={busy||working}
          onClick={()=>void refresh()}
        >
          Refresh ICPs
        </button>
      </div>

      {chosen&&(
        <p className="text-sm text-[#a1a1aa]">
          {chosenIcp?.description}
        </p>
      )}

      {writable?(
        <>
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-sm">
              {selected.length} selected on this page
            </span>

            <button
              className={button}
              disabled={busy||working||!chosen||!selected.length}
              onClick={()=>void change('add')}
            >
              Add ICP tag
            </button>

            <button
              className={button}
              disabled={busy||working||!chosen||!selected.length}
              onClick={()=>void change('remove')}
            >
              Remove ICP tag
            </button>
          </div>

          <details>
            <summary className="cursor-pointer text-indigo-300">
              Create an ICP
            </summary>

            <form
              className="mt-3 space-y-3"
              onSubmit={event=>{
                event.preventDefault();
                void create();
              }}
            >
              <label className="block">
                Name

                <input
                  required
                  maxLength={120}
                  value={name}
                  disabled={busy||working||createUncertain}
                  onChange={event=>setName(event.target.value)}
                  className={`${button} block w-full mt-1`}
                />
              </label>

              <label className="block">
                Fit criteria

                <textarea
                  maxLength={2000}
                  value={description}
                  disabled={busy||working||createUncertain}
                  onChange={event=>setDescription(event.target.value)}
                  placeholder="Describe the industries, roles, and regions your team should consider."
                  className={`${button} block w-full mt-1`}
                />
              </label>

              <p className="text-xs text-[#a1a1aa]">
                Criteria guide your team. They do not automatically classify
                contacts.
              </p>

              <button
                className={button}
                disabled={busy||working||createUncertain||!name.trim()}
              >
                Create ICP
              </button>

              {createUncertain&&(
                <p role="alert">
                  The create outcome is unknown. Refresh ICPs to check for the
                  name before reloading this page and creating anything else.
                </p>
              )}
            </form>
          </details>
        </>
      ):(
        <p className="text-sm text-[#a1a1aa]">
          Your viewer role can filter by ICP. Creating ICPs and changing tags
          require a write role.
        </p>
      )}
    </section>
  );
}
