export as namespace PianoProgressStore;
export const STORAGE_KEY:'music-learning-piano-v1';
export const LOCK_NAME:'melodiajest:piano-progress-v1';
export const META:'melodiajestPersistence';
export const MAX_CHARS:2000000;
export const MAX_RECEIPTS:2048;
export interface Operation {readonly id:string;readonly lessonId:string;readonly fingerprint:string;readonly mode:'challenge'|'memory';readonly clean:boolean;readonly at:number}
export interface Snapshot {readonly pendingCount:number;readonly saving:boolean;readonly code:string|null;readonly generation:number}
export interface Recovery {readonly schemaVersion:1;readonly kind:'piano-legacy-save-recovery';readonly pending:readonly Operation[];readonly baseRaw:string|null;readonly draftRaw:string|null;readonly generation:number}
export type Result={readonly status:'ready'|'saved'}|{readonly status:'unsaved';readonly code:string};
export function parse(raw:string|null):Readonly<Record<string,unknown>>;
export function apply(row:unknown,operation:Operation,now:number):unknown;
export interface Inspection {readonly records:number;readonly progressRecords:number;readonly privateRecords:number;readonly archivedEditions:number;readonly opaqueArchives:number;readonly receiptOperations:readonly Operation[]}
/** Read-only structural validation; legacy summary flags grant no MIDI evidence. */
export function inspect(raw:string|null,now:number):Inspection;
export function isOperation(operation:unknown,now:number):operation is Operation;
export interface Store {snapshot():Snapshot;confirmedProgress():Readonly<Record<string,unknown>>|null;record(operation:Operation):Promise<Result>;refresh():Promise<Result>;retry():Promise<Result>;settled():Promise<Snapshot>;exportRecovery():Recovery}
export function create(dependencies:{readonly storage:{getItem(key:string):string|null;setItem(key:string,value:string):void};readonly locks?:{request<T>(name:string,options:{mode:'exclusive'},work:(lock:unknown)=>T|Promise<T>):Promise<T>};readonly now:()=>number;readonly onChange?:(snapshot:Snapshot)=>void}):Store;
