import {ApiError,getClientHeaders} from './gate1Api';
import {requireUuid} from './query';
export type ExportJob={id:string;list_id:string;format:'csv'|'xlsx';status:string;row_count:number;created_at:string;created_by:string};
export function parseJob(v:any):ExportJob {
  requireUuid(v?.id);requireUuid(v?.list_id);
  if(!['csv','xlsx'].includes(v.format)||!Number.isInteger(v.row_count)||v.row_count<0||typeof v.created_at!=='string'||typeof v.status!=='string')throw new Error('Invalid export response.');
  return v;
}
async function json(path:string,body?:object){
  let r:Response;
  try {r=await fetch('/api/v1'+path,{method:body?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json',...getClientHeaders(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch {throw new ApiError(body?'Export outcome unknown. Review export history before creating another.':'Could not reach the export service.',0,'CONNECTION_FAILED',[],!!body);}
  const v=await r.json().catch(()=>null);
  if(!r.ok||v?.status!=='ok')throw new ApiError(v?.code||'Invalid export response.',r.status,v?.code||'INVALID_RESPONSE',[],!!body&&(!v||r.status>=500));
  return v;
}
export const exportApi={
 history:async():Promise<ExportJob[]>=>{const v=await json('/exports');if(!Array.isArray(v.data))throw new Error('Invalid export history.');return v.data.map(parseJob);},
 create:async(listId:string,format:'csv'|'xlsx')=>{const v=await json('/exports',{list_id:requireUuid(listId),format});try{return parseJob(v.data);}catch{throw new ApiError('Export may have been created. Review export history.',0,'INVALID_RESPONSE',[],true);}},
 download:async(job:ExportJob)=>{
  const r=await fetch(`/api/v1/exports/${requireUuid(job.id)}/download`,{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(60000),headers:getClientHeaders()});
  if(!r.ok)throw new Error(`Download failed (${r.status}). Retry this export's download.`);
  const type=r.headers.get('content-type')||'';
  if(!(job.format==='csv'?type.includes('text/csv'):type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')))throw new Error('Unexpected download type. Reload to verify your session.');
  const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`lumina-export-${job.id}.${job.format}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
};
