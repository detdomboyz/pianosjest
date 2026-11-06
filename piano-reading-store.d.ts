import type {Change,History,Item,OpenOptions,Reason,Result,Session} from './piano-reading-session';
export as namespace PianoReadingStore;
export const STORAGE_KEY:'music-reading-piano-v1';
export const LOCK_NAME:'melodiajest:piano-reading-v1';
export interface StoragePort {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface LockPort {request<T>(name:string,options:{mode:'exclusive'},callback:(lock:unknown)=>Promise<T>):Promise<T>}
export interface Failure {readonly status:'blocked'|'unsaved';readonly code:string;readonly session?:Session}
export interface Store {
  read():Promise<{readonly status:'ready';readonly history:History}|Failure>;
  open(item:Item,options:OpenOptions):Promise<({readonly status:'saved'}&Change)|Failure>;
  openNext(bank:readonly Item[],options:OpenOptions):Promise<({readonly status:'saved';readonly item:Item}&Change)|{readonly status:'exhausted';readonly history:History}|Failure>;
  /** Import into empty history or retry the identical import; never overwrite different local attempts. */
  importHistory(raw:string):Promise<{readonly status:'saved';readonly history:History}|Failure>;
  assist(session:Session,reason:Reason):Promise<({readonly status:'saved'}&Change)|Failure>;
  finish(session:Session,options:{readonly now:string}):Promise<({readonly status:'saved';readonly result:Result}&Change)|Failure>;
}
/** No globals are read at import/create time. Pass the origin's storage and Web Locks. */
export function create(dependencies?:{readonly storage?:StoragePort;readonly locks?:LockPort}):Store;
