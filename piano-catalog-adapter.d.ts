import type {Document} from './music-document';
export as namespace PianoCatalogAdapter;
export const VERSION:1;
export const KEY_MAP:Readonly<Record<string,number>>;
export interface ParsedStep {readonly type:'single'|'chord';readonly keys:readonly string[];readonly raw:string;readonly displayIndex:number;readonly key?:string;readonly quick?:boolean}
export interface ParsedPattern {readonly steps:readonly ParsedStep[];readonly display:readonly ({readonly kind:'space'}|{readonly kind:'unknown';readonly raw:string}|{readonly kind:'step';readonly stepIndex:number;readonly raw:string;readonly type:'single'|'chord'|'quick'})[]}
export function parsePattern(pattern:string):ParsedPattern;
export type JsonValue = null|boolean|number|string|readonly JsonValue[]|{readonly [key:string]:JsonValue|undefined};
export interface LegacyEntry {readonly id:string;readonly pattern:string;readonly [key:string]:JsonValue|undefined}
export interface PianoAssignment {readonly noteId:string;readonly hand:'left'|'right';readonly finger:1|2|3|4|5}
export interface Projection<T extends LegacyEntry=LegacyEntry> {
 readonly schemaVersion:1;readonly kind:'piano-catalog-projection';readonly music:Document;
 readonly execution:{readonly instrument:'piano';readonly documentRevision:string;readonly assignments:readonly PianoAssignment[]};
 readonly warnings:readonly {readonly code:string;readonly stepIndex?:number;readonly noteIndex?:number}[];
 readonly compatibility:{readonly format:'piano-catalog-v7';readonly entry:T};
}
/** IDs are scoped to a serialized catalog revision. This revision is not an assessment fingerprint. */
export function project<T extends LegacyEntry>(entry:T):Projection<T>;
/** Lossless read-only compatibility projection; edited graphs are rejected. */
export function restore<T extends LegacyEntry>(projection:Projection<T>):T;
export function roundTripCatalog<T extends {readonly version:7;readonly lessons:readonly LegacyEntry[];readonly themes:readonly unknown[]}>(snapshot:T):T;
