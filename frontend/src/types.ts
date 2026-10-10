export type View = 'builder' | 'lists' | 'home' | 'contacts' | 'companies' | 'campaigns' | 'clients' | 'import' | 'review' | 'settings' | 'audit';
export type Query = { q: string; filters: Record<string, string> };
export interface Gate1Session { principal_id: string; email: string; client_id: string; client_name: string; role: string; provider: string }
export interface ClientOption { id: string; name: string; role: string }
export interface InterpretData { original_input: string; q: string | null; filters: Record<string,string>; understood_as: string; interpreter_version: string }
export interface Gate1Response<T> { status: 'ok'; data: T; count?: number; member_count?: number; pagination?: {limit:number;offset:number}; interpreted_query?: Query }
export interface Person { id: string; full_name: string | null; current_title?: string | null; department?: string | null; seniority?: string | null; contact_city?: string | null; contact_country?: string | null; company_name?: string | null; company_industry?: string | null; primary_email?: string | null; linkedin_url?: string | null; added_at?: string; added_by?: string }
export interface List { id: string; name: string; member_count: number; created_at: string; created_by?: string; metadata?: { original_input?: string; interpreted_query?: Query; principal_id?: string } }
export interface SavedTarget { id: string; name: string; original_input: string | null; interpreted_query: Query; created_at: string; created_by?: string }
