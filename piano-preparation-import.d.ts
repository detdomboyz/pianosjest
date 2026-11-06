import type {HydratedLesson} from './piano-preparation';
export as namespace PianoPreparationImport;
export const STORAGE_KEY:'music-preparation-transfer-backups-piano-v1';
export const MAX_OPERATIONS:8;
export const MAX_ARCHIVE_DEPTH:8;
export const MAX_ARCHIVE_RECORDS:128;
export const LOCK_NAMES:readonly string[];
export interface Snapshot {readonly saving:boolean;readonly pending:boolean;readonly code:string|null;readonly generation:number}
export interface Failure {readonly status:'blocked'|'unsaved';readonly code:string;readonly raw?:string|null}
export interface Ready {readonly status:'ready';readonly ticket:string;readonly resume:boolean;readonly actions:readonly {readonly key:string;readonly action:'keep'|'identical'|'write'}[];readonly legacyRecoveryArchived:boolean;readonly backupOperations:number}
export interface Saved {readonly status:'saved'|'already-applied';readonly operationId:string}
export interface Store {snapshot():Snapshot;cancel():void;preview(raw:string):Promise<Ready|Saved|Failure>;apply(ticket:string):Promise<Saved|Failure>;readArchive():Promise<{readonly status:'ready';readonly raw:string|null}|Failure>}
export function create(dependencies:{readonly storage:{getItem(key:string):string|null;setItem(key:string,value:string):void};readonly locks?:{request<T>(name:string,options:{mode:'exclusive'},work:(lock:unknown)=>T|Promise<T>):Promise<T>};readonly now:()=>number;readonly lessons:()=>readonly HydratedLesson[];readonly id:()=>string;readonly allowed?:()=>boolean;readonly onChange?:(snapshot:Snapshot)=>void}):Store;
