import type { ClientOption, Gate1Response, Gate1Session, InterpretData, List, Person, Query, SavedTarget } from '../types';
import { normalizeQuery, requireUuid } from './query';

let clientContext = '';
const sessionListeners = new Set<() => void>();
export const getClientHeaders = (): Record<string,string> => clientContext ? {'X-Lumina-Client-Id':clientContext} : {};
export const notifySessionFailure = () => sessionListeners.forEach(fn => fn());
export const setClientContext = (id: string) => { clientContext = id ? requireUuid(id) : ''; };
export const onSessionFailure = (fn: () => void) => { sessionListeners.add(fn); return () => { sessionListeners.delete(fn); }; };
export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '', public available_clients: ClientOption[] = [], public uncertainWrite = false) { super(message); }
}
const friendly: Record<string,string> = {
  AUTHENTICATION_REQUIRED: 'Your session expired. Reload Lumina to sign in again.',
  NO_ACTIVE_CLIENT_MEMBERSHIP: 'Your account has no active client membership.',
  INSUFFICIENT_ROLE: 'Your role does not allow this change.',
  CLIENT_CONTEXT_REQUIRED: 'Choose a client to continue.',
  IAP_BOOTSTRAP_REQUIRED: 'Your account still needs backend membership setup.',
};
async function request<T>(path: string, options: RequestInit = {}): Promise<Gate1Response<T>> {
  const writes = options.method === 'POST' && !['/search/people','/search/interpret'].includes(path);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options, credentials: 'include', cache: 'no-store', redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(25000),
      headers: { 'Accept': 'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(clientContext ? {'X-Lumina-Client-Id':clientContext} : {}), ...options.headers },
    });
  } catch {
    throw new ApiError(writes ? 'The response was lost. The change may have been saved. Inspect Lead Lists or Saved Targets before trying again.' : 'Could not reach the authenticated backend. Reload Lumina to sign in, or retry the connection.', 0, 'CONNECTION_FAILED', [], writes);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status !== 'ok' || !Object.hasOwn(result ?? {}, 'data')) {
    if (response.status === 401 || response.status === 403) sessionListeners.forEach(fn => fn());
    const code = typeof result?.code === 'string' ? result.code : 'INVALID_RESPONSE';
    const clients = Array.isArray(result?.available_clients) ? result.available_clients : [];
    throw new ApiError(friendly[code] || result?.message || `Backend request failed (${response.status}; ${code}).`, response.status, code, clients, writes && (!result || response.status >= 500));
  }
  return result;
}
export const gate1Api = {
  getSession: () => request<Gate1Session>('/session'),
  interpret: (input: string) => request<InterpretData>('/search/interpret',{method:'POST',body:JSON.stringify({input})}),
  searchPeople: (query: Query, limit=50, offset=0) => request<Person[]>('/search/people',{method:'POST',body:JSON.stringify({interpreted_query:normalizeQuery(query),limit,offset})}),
  getSavedTargets: () => request<SavedTarget[]>('/saved-targets'),
  saveTarget: (data: {name:string;original_input:string;interpreted_query:Query}) => request<SavedTarget>('/saved-targets',{method:'POST',body:JSON.stringify({...data,interpreted_query:normalizeQuery(data.interpreted_query)})}),
  getLists: () => request<List[]>('/lists'),
  createListFromSelection: (data: {name:string;person_ids:string[];original_input:string;interpreted_query:Query}) => request<List>('/lists/from-selection',{method:'POST',body:JSON.stringify({...data,person_ids:data.person_ids.map(requireUuid),interpreted_query:normalizeQuery(data.interpreted_query)})}),
  getListMembers: (id: string, limit=50, offset=0) => request<Person[]>(`/lists/${requireUuid(id)}/members?limit=${limit}&offset=${offset}`),
};
