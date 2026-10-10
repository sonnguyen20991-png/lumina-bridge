import React, {createContext, useContext, useEffect, useState} from 'react';
import {ApiError, gate1Api, onSessionFailure, setClientContext} from '../services/gate1Api';
import type {ClientOption, Gate1Session} from '../types';

const SessionContext = createContext<Gate1Session | null>(null);
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('Verified session required.'); return value; }
export const canWrite = (role: string) => ['owner','admin','manager','member'].includes(role);
export function SessionGate({children}: {children:React.ReactNode}) {
  const [session,setSession] = useState<Gate1Session|null>(null);
  const [busy,setBusy] = useState(true);
  const [error,setError] = useState('');
  const [clients,setClients] = useState<ClientOption[]>([]);
  const [chosen,setChosen] = useState('');
  async function verify() {
    setBusy(true);setError('');
    try {
      const res=await gate1Api.getSession();
      if (res.data.provider !== 'iap' || !res.data.principal_id || !res.data.client_id) throw new Error('The backend did not return a verified IAP session.');
      setSession(res.data);setClients([]);
    } catch(e) {
      setSession(null);setError(e instanceof Error ? e.message : 'Session verification failed.');
      if(e instanceof ApiError) setClients(e.available_clients);
    } finally {setBusy(false);}
  }
  useEffect(()=>{void verify();return onSessionFailure(()=>{setSession(null);setError('Your session or membership changed. Verify again to continue.');});},[]);
  if(busy) return <div className="py-32 text-center text-[#71717a]" role="status">Verifying your session…</div>;
  if(!session) return <div className="py-32 text-center space-y-6 max-w-lg mx-auto">
    <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto text-rose-500"><span className="material-symbols-outlined text-3xl">database_off</span></div>
    <h1 className="text-xl font-bold text-white uppercase tracking-tight">Database connection required</h1>
    <p className="text-sm text-[#a1a1aa]" role="alert">{error || 'A verified IAP session is required.'}</p>
    {clients.length>0 && <label className="block text-left text-sm">Client<select aria-label="Client context" value={chosen} onChange={e=>setChosen(e.target.value)} className="block w-full mt-2 bg-[#18181b] border border-[#27272a] rounded-xl p-3"><option value="">Choose a client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <button disabled={busy || (clients.length>0&&!chosen)} onClick={()=>{if(clients.length>0)setClientContext(chosen);void verify();}} className="px-8 py-3 bg-white text-black text-xs font-bold uppercase tracking-widest rounded-xl disabled:opacity-30">{clients.length ? 'Open Client' : 'Retry Connection'}</button>
    <a href="/app/" className="block text-sm text-indigo-400">Reload to sign in</a>
  </div>;
  return <SessionContext.Provider value={session}><div className="lumina-sessionbar mb-8 flex flex-wrap gap-3 items-center text-xs text-[#71717a] border-b border-[#1c1c1f] pb-4"><span className="lumina-session-status text-emerald-400">Authenticated</span><span>{session.client_name}</span><span className="lumina-session-email ml-auto">{session.email}</span><span>{session.role}</span></div>{children}</SessionContext.Provider>;
}
