export const FILTER_LABELS = {title:'Title',department:'Department',seniority:'Seniority',location:'Location',city:'City',country:'Country',company:'Company',industry:'Industry',domain:'Domain',email:'Email'};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function requireUuid(id: string) { if (!UUID.test(id)) throw new Error('The backend returned an invalid record ID.'); return id; }
export function normalizeQuery(value: unknown): {q:string;filters:Record<string,string>} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid target query.');
  const query = value as {q?:unknown;filters?:unknown};
  if (query.q != null && (typeof query.q !== 'string' || query.q.length > 1000)) throw new Error('Search text must be at most 1,000 characters.');
  if (query.filters != null && (typeof query.filters !== 'object' || Array.isArray(query.filters))) throw new Error('Invalid target filters.');
  const filters: Record<string,string> = {};
  for (const [key,value] of Object.entries(query.filters ?? {})) {
    if (!Object.hasOwn(FILTER_LABELS,key)) throw new Error(`The backend does not support the ${key} filter.`);
    if (typeof value !== 'string' || value.length > 500) throw new Error('Each filter must contain one text value, at most 500 characters.');
    if (value.trim()) filters[key] = value.trim();
  }
  return {q:typeof query.q === 'string' ? query.q.trim() : '',filters};
}
export function verifyMembership(expected: string[], actual: {id:string}[], declared?: number) {
  const selected = new Set(expected);
  const found = new Set(actual.map(p=>p.id));
  return declared === selected.size && found.size === selected.size && actual.length === selected.size && [...selected].every(id=>found.has(id));
}
