export as namespace MusicDocument;
export const VERSION: 1;
export type Pitch = {readonly kind:'midi';readonly value:number} | {readonly kind:'frequency';readonly hz:number} | {readonly kind:'unpitched';readonly key:string};
export type NoteSpan = {readonly kind:'known';readonly start:number;readonly duration:number} | {readonly kind:'unknown'};
/** One span per sounding note; quarter units are retained without quantization. */
export interface Note {readonly id:string;readonly partId:string;readonly pitch:Pitch;readonly span:NoteSpan}
export interface Document {readonly schemaVersion:1;readonly id:string;readonly revision:string;readonly timeUnit:'quarter';readonly bpm:number|null;readonly parts:readonly {readonly id:string}[];readonly notes:readonly Note[]}
export interface Validation {readonly valid:boolean;readonly issues:readonly {readonly code:string;readonly path:string}[]}
export function validate(document:unknown):Validation;
export function assertValid(document:unknown):Document;
