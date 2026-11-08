import type {Store,Snapshot,Recovery,Operation,Result} from './piano-progress-store';
export as namespace PianoLegacyCheckpointOwner;
export const VERSION:1;
export const FORMAT:'melodiajest-legacy-progress-owner-v1';
declare const tokenBrand:unique symbol;
export interface Token {
 readonly [tokenBrand]:true;
 readonly format:typeof FORMAT;readonly version:1;readonly componentId:'legacy-progress';readonly generation:number;readonly sourceGeneration:number;readonly pendingCount:number;readonly confirmedAvailable:boolean;readonly codeUnits:number;readonly completeCopy:false;
}
export interface Observation {readonly id:'legacy-progress';readonly status:'observed';readonly raw:string;readonly generation:number}
export interface Envelope {readonly format:typeof FORMAT;readonly version:1;readonly sourceGeneration:number;readonly snapshot:Snapshot;readonly confirmed:Readonly<Record<string,unknown>>|null;readonly recovery:Recovery}
export interface Owner extends Store {
 /** Synchronous, no storage reads. Refuses an active writer call/job or notification. Only this owner participates. */
 prepareCheckpoint():Token;
 /** A historical immutable private observation; later writes do not erase the prepared token. */
 readCheckpoint(token:Token):Observation;
 /** Same owner revision and serialized memory only. Not a lock, persisted-value test, multi-tab barrier or apply permission. */
 isCurrent(token:Token):boolean;
 /** Invalidates checkpoint tokens only. Accepted writes, pending operations and the legacy writer continue. */
 closeCheckpoint():void;
 record(operation:Operation):Promise<Result>;
}
export function create(options:Parameters<typeof import('./piano-progress-store').create>[0]):Owner;
