import {ApiError, getClientHeaders, notifySessionFailure} from './gate1Api';
import {requireUuid} from './query';
export interface Mapping { original: string; target: string }
export interface ImportLifecycleEvent {
  action: string;
  created_at?: string | null;
  details?: Record<string, unknown> | null;
}

export interface ImportDiagnostics {
  async?: boolean;
  retryable?: boolean;
  retry_count?: number | null;
  failure_code?: string | null;
  error_code?: string | null;
  legacy_failure?: boolean;
}

export interface ImportJob {
  id: string;
  client_id: string;
  filename: string;
  source_name: string;
  status: string;

  total_rows: number;
  processed_rows: number;
  inserted_rows: number;
  updated_rows: number;
  matched_rows: number;
  duplicate_rows: number;
  rejected_rows: number;
  conflict_rows: number;
  suppressed_rows: number;

  progress_percent?: number;
  created_at?: string;

  metadata?: {
    uploaded_by?: string;
    principal_id?: string;
    file_import?: {
      header_mapping?: Mapping[];
    };
  };

  diagnostics?: ImportDiagnostics;
  events?: ImportLifecycleEvent[];
}
export interface Receipt {status:string; import_job_id:string; file_import?:{header_mapping?:Mapping[]}}
export interface PendingImport {version:1; key:string; filename:string; size:number; sha256:string; source:string; jobId?:string; mapping?:Mapping[]}
export interface ImportReviewRow {
  row_id: string;
  row_number: number;
  person_id?: string | null;
  person_status?: string | null;
  outcome: string;
  reason?: string | null;

  full_name?: string | null;
  current_title?: string | null;
  department?: string | null;
  seniority?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  contact_country?: string | null;

  raw_payload: Record<string, unknown>;
}

export interface ImportReviewPage {
  job: ImportJob;
  rows: ImportReviewRow[];
  total: number;
  can_create_list: boolean;
}

export interface ImportReviewListReceipt {
  id?: string;
  name: string;
}

export const terminal = (status:string) => ['completed','failed','cancelled'].includes(status);
export function completionLabel(job:ImportJob) {
  if(job.status==='completed') return job.rejected_rows===job.total_rows && job.total_rows>0 ? 'Completed — all rows rejected' : job.rejected_rows>0 ? 'Completed with rejected rows' : job.conflict_rows>0 ? 'Completed with conflicts to review' : 'Completed';
  return job.status==='failed' ? 'Import failed' : job.status;
}
function mappings(value:unknown):Mapping[] {
  if(!Array.isArray(value)) return [];
  return value.filter((x):x is Mapping => typeof x?.original==='string'&&typeof x?.target==='string');
}
export function parseReceipt(value:any):Receipt {
  if(!['ok','queued'].includes(value?.status))throw new Error('The upload response was not a recognized import receipt.');
  const id = requireUuid(value.import_job_id ?? value.import_job?.id);
  return {status:value.status, import_job_id:id,file_import:{header_mapping:mappings(value.file_import?.header_mapping)}};
}
export function parseJob(value:any, id:string, clientId:string):ImportJob {
  if(value?.status!=='ok'||!value.import_job)throw new Error('The backend did not return an import job.');
  const job=value.import_job;
  if(job.id!==requireUuid(id)||job.client_id!==clientId)throw new Error('The import job does not match this client and job ID.');
  for(const key of ['total_rows','processed_rows','inserted_rows','updated_rows','matched_rows','duplicate_rows','rejected_rows','conflict_rows','suppressed_rows']) {
    if(!Number.isSafeInteger(job[key])||job[key]<0)throw new Error('Invalid import counts returned by the backend.');
  }
  if(job.processed_rows>job.total_rows||typeof job.status!=='string')throw new Error('Invalid import progress returned by the backend.');
  return {...job,metadata:{...job.metadata,file_import:{...job.metadata?.file_import,header_mapping:mappings(job.metadata?.file_import?.header_mapping)}}};
}
export function validateFile(file:Pick<File,'name'|'size'>) {
  if(!/\.(csv|xlsx)$/i.test(file.name))throw new Error('Choose a CSV or XLSX file.');
  if(file.size===0)throw new Error('The selected file is empty.');
  if(file.size>10*1024*1024)throw new Error('The file exceeds the 10 MiB upload limit.');
}
export function readPending(storage:Storage, key:string):PendingImport|null {
  try {
    const x=JSON.parse(storage.getItem(key)||'null');
    if(x?.version!==1||typeof x.key!=='string'||!/^lumina-ui-[0-9a-f-]+$/i.test(x.key)||typeof x.filename!=='string'||typeof x.sha256!=='string'||! /^[0-9a-f]{64}$/.test(x.sha256)||!Number.isSafeInteger(x.size)||typeof x.source!=='string')return null;
    if(x.jobId)requireUuid(x.jobId);
    return {...x,mapping:mappings(x.mapping)};
  }catch{return null;}
}
async function call(path:string, init:RequestInit, write=false):Promise<any> {
  let response:Response;
  try {response=await fetch(`/api/v1${path}`,{...init,credentials:'include',cache:'no-store',redirect:'error',headers:{Accept:'application/json',...getClientHeaders()},signal:init.signal??AbortSignal.timeout(write?120000:25000)});}
  catch {throw new ApiError(write?'Upload outcome unknown. Keep this submission and check it using the same file.':'Could not read import progress. Use Refresh Status to check again.',0,'CONNECTION_FAILED',[],write);}
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result||result.status==='error') {
    if([401,403].includes(response.status))notifySessionFailure();
    throw new ApiError(result?.message||`Import request failed (${response.status}; ${result?.code||'INVALID_RESPONSE'}).`,response.status,result?.code||'INVALID_RESPONSE',[],write&&(!result||response.status>=500));
  }
  return result;
}
export const importApi={
  async upload(file:File,pending:PendingImport) {
    validateFile(file);
    const body=new FormData();body.append('file',file);body.append('source_name',pending.source);body.append('idempotency_key',pending.key);
    const result=await call('/imports/file',{method:'POST',body},true);
    try {return parseReceipt(result);}catch {throw new ApiError('Upload outcome unknown: the backend receipt could not be verified. Keep this submission and check using the same file.',200,'INVALID_RECEIPT',[],true);}
  },
  async getJob(id:string,clientId:string,signal?:AbortSignal) {
    return parseJob(
      await call(`/import-jobs/${requireUuid(id)}`,{signal}),
      id,
      clientId,
    );
  },

  async retryJob(id:string) {
    return call(
      `/import-jobs/${requireUuid(id)}/retry`,
      {method:'POST'},
      true,
    );
  },

  async getReviewRows(
    id:string,
    outcome:string,
    offset:number,
    q:string,
    signal?:AbortSignal,
  ):Promise<ImportReviewPage> {
    const result=await call(
      `/import-jobs/${requireUuid(id)}/rows?outcome=${encodeURIComponent(outcome)}&offset=${offset}&q=${encodeURIComponent(q)}`,
      {signal},
    );

    if(
      result?.status!=='ok' ||
      !result.data ||
      !result.data.job ||
      !Array.isArray(result.data.rows) ||
      !Number.isSafeInteger(result.data.total) ||
      typeof result.data.can_create_list!=='boolean'
    ){
      throw new Error('Invalid import review response.');
    }

    return result.data;
  },

  async createReviewList(
    jobId:string,
    data:{id:string;name:string;person_ids:string[]},
  ):Promise<ImportReviewListReceipt> {
    const result=await call(
      `/import-jobs/${requireUuid(jobId)}/review-list`,
      {
        method:'POST',
        body:JSON.stringify({
          id:requireUuid(data.id),
          name:data.name,
          person_ids:data.person_ids.map(requireUuid),
        }),
        headers:{'Content-Type':'application/json'},
      },
      true,
    );

    if(
      result?.status!=='ok' ||
      !result.data ||
      typeof result.data.name!=='string'
    ){
      throw new ApiError(
        'Could not verify the created lead list. Refresh Lead Lists before trying again.',
        200,
        'INVALID_RESPONSE',
        [],
        true,
      );
    }

    return result.data;
  }
};
