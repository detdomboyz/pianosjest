import type {Candidate,Counts} from './piano-browser-checkpoint-candidate';
export as namespace PianoBrowserCheckpointStore;
export const VERSION:1;
export const DATABASE:'melodiajest-browser-checkpoints-v1';
export const STORE:'candidates';
export const CAPACITY:4;
export const FORMAT:'melodiajest-browser-checkpoint-store-v1';
export type ErrorCode='INPUT'|'LIMIT'|'UNAVAILABLE'|'DIGEST'|'CLOSED'|'BLOCKED'|'SCHEMA'|'INTEGRITY'|'QUOTA'|'ABORTED'|'CAPACITY'|'UNCONFIRMED';
/** UNCONFIRMED is not a failed-write guarantee; inspect writeMayHaveCommitted and retry an explicit read. */
export type StoreError=(Error&{readonly name:'BrowserCheckpointStoreError';readonly code:Exclude<ErrorCode,'UNCONFIRMED'>})|(Error&{readonly name:'BrowserCheckpointStoreError';readonly code:'UNCONFIRMED';readonly writeMayHaveCommitted:boolean;readonly reasonCode:ErrorCode});
export interface Receipt {
 readonly format:typeof FORMAT;readonly version:1;readonly id:string;readonly storedAt:string;readonly capturedAt:string;
 readonly status:'stored-incomplete';readonly completeCopy:false;readonly consistency:'uncoordinated';readonly counts:Counts;readonly reasons:readonly string[];
 readonly operation:'saved'|'reused'|'read';readonly readbackVerified:true;readonly durability:'strict'|'relaxed'|'default'|'unknown';readonly evictionProtectionRequested:false;
}
export interface ReadResult {readonly receipt:Receipt;readonly candidate:Candidate}
export interface Store {
 /** Adds at most four observations. Never overwrites/evicts. Acknowledges only after transaction complete and verified fresh read. */
 save(candidate:Candidate):Promise<Receipt>;
 /** Explicit private read of this fixed database only. Missing IDs return null; corruption is an error. */
 read(id:string):Promise<ReadResult|null>;
 close():void;
}
/** No global API access, source writers, app restore, deletion, network, persistence permission or production activation. */
export function create(options:{readonly indexedDB:Pick<IDBFactory,'open'>;readonly subtle:Pick<SubtleCrypto,'digest'>;readonly name?:string;readonly now?:()=>string}):Store;
