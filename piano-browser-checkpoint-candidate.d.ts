export as namespace PianoBrowserCheckpointCandidate;
export const VERSION:1;
export const FORMAT:'melodiajest-browser-checkpoint-candidate-v1';
export const KEYS:readonly ['piano-blind-trainer-catalog-v1','piano-blind-trainer-ui-v20','music-catalog-workspace-piano-v1','music-learning-piano-v1','music-preparation-piano-v1','music-preparation-fragments-piano-v1','music-preparation-transfer-backups-piano-v1'];
export const COMPONENT_IDS:readonly ['catalog-state','ui-workspace','legacy-progress','whole-capture','fragment-capture','transfer','editor-draft','active-attempt'];
export const MAX_VALUE_CODE_UNITS:number;
export const MAX_TOTAL_CODE_UNITS:number;
export type Key=typeof KEYS[number];
export type ComponentId=typeof COMPONENT_IDS[number];
export type ComponentInput={readonly id:ComponentId;readonly status:'observed';readonly raw:string|null;readonly generation:number}|{readonly id:ComponentId;readonly status:'unavailable';readonly reason:'NOT_CAPTURED'|'UNSUPPORTED'|'READ_FAILED'};
export interface Counts {readonly persistedObserved:number;readonly persistedUnavailable:number;readonly componentsObserved:number;readonly componentsUnavailable:number;readonly rawCodeUnits:number}
export interface Metadata {readonly format:typeof FORMAT;readonly version:1;readonly id:string;readonly capturedAt:string;readonly status:'prepared-incomplete';readonly completeCopy:false;readonly consistency:'uncoordinated';readonly counts:Counts;readonly reasons:readonly string[]}
declare const tokenBrand:unique symbol;
export interface Token extends Metadata {readonly [tokenBrand]:true}
export type PersistedObservation={readonly key:Key;readonly status:'observed';readonly raw:string|null;readonly digest:string;readonly codeUnits:number}|{readonly key:Key;readonly status:'unavailable';readonly reason:'READ_FAILED'|'READ_INVALID'};
export type ComponentObservation=(Extract<ComponentInput,{status:'observed'}>&{readonly digest:string;readonly codeUnits:number})|Extract<ComponentInput,{status:'unavailable'}>;
/** Private exact strings. No component validation, coordinated capture, durable save or application restore is implied. */
export interface Candidate extends Metadata {readonly persisted:readonly PersistedObservation[];readonly components:readonly ComponentObservation[]}
export interface Builder {
 /** Reads only the seven fixed keys once, synchronously before any digest await. Pending inputs must be explicitly captured by their owners. */
 prepareFrom(storage:Pick<Storage,'getItem'>,components?:readonly ComponentInput[]):Promise<Token>;
 /** Explicit private in-memory read. JSON clones and other builder tokens are rejected. No storage/database write exists. */
 readCandidate(token:Token):Candidate;
 close():void;
}
export function create(options:{readonly subtle:Pick<SubtleCrypto,'digest'>;readonly now?:()=>string}):Builder;
