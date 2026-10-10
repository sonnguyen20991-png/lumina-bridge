export type View = 'builder' | 'home' | 'lists' | 'contacts' | 'clients' | 'campaigns' | 'import' | 'settings';
export type Query = { q: string; filters: Record<string, string> };
export interface Gate1Session { principal_id: string; email: string; client_id: string; client_name: string; role: string; provider: string }
export interface ClientOption { id: string; name: string; role: string }
export interface InterpretData { original_input: string; q: string | null; filters: Record<string,string>; understood_as: string; interpreter_version: string }
export interface Gate1Response<T> { status: 'ok'; data: T; count?: number; member_count?: number; pagination?: {limit:number;offset:number}; interpreted_query?: Query }
export interface Person {
  id: string;
  full_name: string | null;
  current_title?: string | null;
  department?: string | null;
  seniority?: string | null;
  contact_city?: string | null;
  contact_country?: string | null;
  company_name?: string | null;
  company_industry?: string | null;
  company_domain?: string | null;
  company_website?: string | null;
  company_linkedin_url?: string | null;
  company_city?: string | null;
  company_country?: string | null;
  primary_email?: string | null;
  email_validation_status?: string | null;
  primary_phone?: string | null;
  primary_phone_type?: string | null;
  linkedin_url?: string | null;
  icp_tags?: Array<{ id: string; name: string }>;
  added_at?: string;
  added_by?: string;
}

export interface ContactIntelligence {
  person?: {
    contact_city?: string | null;
    contact_country?: string | null;
    department?: string | null;
    seniority?: string | null;
    linkedin_url?: string | null;
  };
  contact?: {
    primary_email?: string | null;
    email_validation_status?: string | null;
    primary_phone?: string | null;
    primary_phone_type?: string | null;
  };
  company?: {
    name?: string | null;
    industry?: string | null;
    city?: string | null;
    country?: string | null;
    website?: string | null;
  } | null;
  freshness?: {
    open?: boolean;
    latest?: {
      freshness_result?: string | null;
      completed_at?: string | null;
      confidence?: number | null;
    } | null;
  };
  enrichment?: Array<{
    id?: string;
    attribute_key?: string;
    attribute_label?: string;
    value?: unknown;
    source_name?: string | null;
  }>;
  employment_history?: Array<{
    id: string;
    title?: string | null;
    company_name?: string | null;
    department?: string | null;
    seniority?: string | null;
    is_current?: boolean;
  }>;
  campaigns?: Array<{
    campaign_id: string;
    campaign_name?: string | null;
    stage?: string | null;
    participation_status?: string | null;
    note?: string | null;
  }>;
}
export interface List { id: string; name: string; member_count: number; created_at: string; created_by?: string; metadata?: { original_input?: string; interpreted_query?: Query; principal_id?: string } }
export interface SavedTarget { id: string; name: string; original_input: string | null; interpreted_query: Query; created_at: string; created_by?: string }

export interface CampaignSummary {
  id: string;
  name: string;
  participant_count: number;
  created_at?: string;
  created_by?: string;
}
