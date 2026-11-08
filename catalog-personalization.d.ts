export as namespace CatalogPersonalization;
export type JsonValue=null|boolean|number|string|readonly JsonValue[]|{readonly[key:string]:JsonValue};
export interface Record {readonly id:string;readonly[key:string]:JsonValue}
export interface Snapshot {readonly version:7;readonly savedAt?:string|null;readonly themes:readonly Record[];readonly lessons:readonly Record[];readonly[key:string]:JsonValue|undefined}
export type Slot={readonly present:false}|{readonly present:true;readonly value:JsonValue};
export interface FieldChange {readonly key:string;readonly before:Slot;readonly after:Slot}
export interface Table {readonly order:readonly string[];readonly created:readonly Record[];readonly removed:readonly string[];readonly patches:readonly {readonly id:string;readonly fields:readonly FieldChange[]}[]}
export interface Personal {readonly version:1;readonly kind:'melodiajest-personal-catalog';readonly baseRelease:string;readonly savedAt:string|null;readonly themes:Table;readonly lessons:Table;readonly fields:readonly FieldChange[]}
export type Result={readonly ok:true;readonly conflicts:readonly [];readonly snapshot:Snapshot}|{readonly ok:false;readonly conflicts:readonly {readonly code:string;readonly id:string;readonly key:string}[];readonly snapshot:null};
export function create(base:Snapshot,current:Snapshot,options:{baseRelease:string}):Personal;
export function validate(value:unknown):Personal;
export function apply(base:Snapshot,personal:Personal):Result;
export function equivalent(a:unknown,b:unknown):boolean;
export const VERSION:1;
export const KIND:'melodiajest-personal-catalog';
export const MAX_BYTES:number;
