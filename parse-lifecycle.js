import {createParseClient,LARGE_WARN_BYTES,HARD_LIMIT_BYTES} from './core/parse-client.js';
export const LARGE_LIMIT=LARGE_WARN_BYTES, FILE_LIMIT=HARD_LIMIT_BYTES, MARKER_KEY='vidoviewer-loading';
export class ParseLifecycle {
 constructor({client=createParseClient({workerUrl:new URL('./core/parse-worker.js',import.meta.url)}),timeoutMs=120000,storage=localStorage}={}){this.client=client;this.timeoutMs=timeoutMs;this.storage=storage;this.current=null}
 interrupted(){try{return !!this.storage.getItem(MARKER_KEY)}catch{return false}}
 clearInterrupted(){try{this.storage.removeItem(MARKER_KEY)}catch{}}
 cancel(){this.current?.job.cancel()}
 async start(file,{onStage}={}){
  this.cancel();const state={id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,job:null,marker:false};this.current=state;
  if(file.size>FILE_LIMIT){this.current=null;return {status:'too-large'}}
  if(file.size>LARGE_LIMIT){try{this.storage.setItem(MARKER_KEY,state.id);state.marker=true}catch{this.current=null;return {status:'storage-error'}}}
  try{state.job=this.client.parse(file,{timeoutMs:this.timeoutMs,onStage});const result=await state.job.promise;if(this.current!==state)return {status:'cancelled'};return {status:'done',value:result.scene,stats:result.stats}}
  catch(e){return {status:e.code==='cancelled'?'cancelled':e.code==='timeout'?'timeout':e.code==='too-large'?'too-large':'error',value:e.message}}
  finally{if(state.marker){try{if(this.storage.getItem(MARKER_KEY)===state.id)this.storage.removeItem(MARKER_KEY)}catch{}}if(this.current===state)this.current=null}
 }
 dispose(){this.cancel();this.client.dispose()}
}
