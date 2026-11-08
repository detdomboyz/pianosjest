export const VERSION:1;
export const DATABASE:'melodiajest-legacy-catalog-v1';
export const KEY:'piano-blind-trainer-catalog-v1';
export const CAPACITY:4;
export const MAX_CODE_UNITS:number;
export interface Metadata {readonly id:string;readonly key:typeof KEY;readonly codeUnits:number;readonly missing:boolean;readonly capturedAt:string}
declare const changeBrand:unique symbol;
export interface Change extends Metadata {readonly [changeBrand]:true;readonly version:1}
/** Private original string, including malformed JSON and unpaired UTF-16 units. Never log/send automatically. */
export interface Snapshot {readonly format:'melodiajest-legacy-catalog-copy-v1';readonly id:string;readonly key:typeof KEY;readonly raw:string|null;readonly codeUnits:number;readonly capturedAt:string}
export interface Copies {
 /** Reads only the fixed legacy catalog key once, synchronously before the digest await. Does not migrate or write it. */
 prepareFrom(storage:Pick<Storage,'getItem'>):Promise<Change>;
 /** Saves immutable original; resolves at native transaction.complete. Original change must belong to this instance. */
 commit(change:Change):Promise<{readonly status:'saved'|'replayed';readonly durability:string;readonly snapshot:Metadata}>;
 /** Explicit private readback; verifies SHA256 outside the short read transaction. */
 read(id:string):Promise<Snapshot|null>;
 /** Explicit private export, including unrecognized records, without repair/deletion. */
 exportRecovery():Promise<string>;
 close():void;
}
export function create(options:{readonly indexedDB:IDBFactory;readonly subtle:Pick<SubtleCrypto,'digest'>;readonly name?:string;readonly now?:()=>string}):Copies;
