import {ApiError,getClientHeaders,notifySessionFailure} from './gate1Api';
import {requireUuid} from './query';
export interface Conflict {id:string;entity_type:string;company_name:string|null;field_name:string;existing_value:string|null;incoming_value:string|null;current_value:string|null;status:string;source_name:string|null;version:string;resolvable:boolean;blocked_reason:string|null;protected:boolean;resolution_note?:string|null;resolved_by?:string|null}
export interface ReviewPage {status:'ok';data:Conflict[];can_resolve:boolean;pagination:{offset:number;limit:number;has_more:boolean}}
export function parsePage(x:any):ReviewPage {
 if(x?.status!=='ok'||!Array.isArray(x.data)||typeof x.can_resolve!=='boolean'||!Number.isSafeInteger(x.pagination?.offset)||typeof x.pagination?.has_more!=='boolean')throw new Error('Invalid conflict review response.');
 for(const c of x.data){requireUuid(c.id);if(typeof c.field_name!=='string'||typeof c.status!=='string'||! /^[a-f0-9]{64}$/.test(c.version)||typeof c.resolvable!=='boolean')throw new Error('Invalid conflict record.');}
 return x;
}
async function call(path:string,body?:unknown,signal?:AbortSignal){
 const write=body!==undefined;let response;
 try{response=await fetch(`/api/v1${path}`,{method:write?'POST':'GET',body:write?JSON.stringify(body):undefined,credentials:'include',cache:'no-store',redirect:'error',signal:signal??AbortSignal.timeout(25000),headers:{Accept:'application/json',...getClientHeaders(),...(write?{'Content-Type':'application/json','X-Lumina-Review':'1'}:{})}});}catch{throw new ApiError(write?'Decision outcome unknown. Refresh conflicts before making another decision.':'Could not load conflicts.',0,'CONNECTION_FAILED',[],write);}
 const x=await response.json().catch(()=>null);
 if(!response.ok||x?.status!=='ok'){if(response.status===401)notifySessionFailure();throw new ApiError(x?.code||'Invalid review response.',response.status,x?.code||'INVALID_RESPONSE',[],write&&(!x||response.status>=500));}
 return x;
}
export const conflictApi={
 async list(job:string,offset:number,signal?:AbortSignal){return parsePage(await call(`/import-jobs/${requireUuid(job)}/conflicts?offset=${offset}`,undefined,signal));},
 async resolve(job:string,c:Conflict,decision:'keep_existing'|'accept_incoming',note:string){const x=await call(`/import-jobs/${requireUuid(job)}/conflicts/${requireUuid(c.id)}/resolve`,{decision,note,version:c.version,acknowledge_shared:true});if(x.data?.id!==c.id||x.data?.status!==(decision==='keep_existing'?'resolved_existing':'resolved_incoming'))throw new ApiError('Decision outcome unknown. Refresh conflicts to verify.',200,'INVALID_RESOLUTION',[],true);return x;}
};
