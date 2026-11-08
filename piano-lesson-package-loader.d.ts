import type {Catalog} from './piano-lesson-parts';
import type {Pin} from './piano-lesson-package-update';
export const VERSION:1;
export const MAX_PACKAGE_BYTES:number;
export type FailureCode='INPUT'|'SOURCE'|'STALE'|'NETWORK'|'HTTP'|'INTEGRITY'|'CONTRACT'|'LIMIT'|'UNAVAILABLE'|'ABORTED'|'TIMEOUT';
export interface LoadError extends Error {readonly name:'LessonPackageLoadError';readonly code:FailureCode}
export interface Stats {readonly requests:number;readonly networkBytes:number;readonly cacheHits:number;readonly cacheReadFailures:number;readonly cacheWriteFailures:number;readonly verifiedFiles:number}
declare const loadedBrand:unique symbol;
export interface Loaded {readonly [loadedBrand]:true;readonly active:Pin;readonly catalog:Catalog;readonly stats:Stats}
export interface Input {readonly pin:Pin;readonly active?:Pin|null;readonly signal?:AbortSignal|null;readonly timeoutMs?:number;readonly reload?:boolean}
export interface Configuration {
 readonly baseUrl:string;readonly origin:string;
 readonly fetch:(url:string,init:RequestInit)=>Promise<Response>;
 readonly subtle:Pick<SubtleCrypto,'digest'>;
 readonly cache?:Pick<Cache,'match'|'put'>|null;
}
/** No fetch, CacheStorage or catalog storage is accessed by import/create. */
export function create(config:Configuration):{readonly load:(input:Input)=>Promise<Loaded>};
/** Only an original, verified in-memory result is accepted; serialized/cloned objects fail. */
export function requireVerified(value:unknown):Loaded;
