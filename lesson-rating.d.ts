export as namespace LessonRating;
export type System='ten'|'ten_decimal'|'hundred'|'five'|'three'|'two';
export type Value=number|'bad'|'normal'|'good'|'like'|'dislike';
export interface SavedRating {readonly system:System;readonly value:Value;readonly canonicalUnits:number}
export interface Average {readonly canonical:number;readonly decimalTen:number;readonly count:number}
export const VERSION:1;
export const DEFAULT:'ten';
export const SYSTEMS:readonly System[];
export const META:Readonly<Record<System,{readonly label:string;readonly min?:number;readonly max?:number;readonly step?:number;readonly values?:readonly string[]}>>;
export function normalize(system:System,value:unknown):Value|null;
export function roundHalfDown(value:number):number;
export function toCanonical(system:System,value:unknown):number|null;
export function fromCanonical(system:System,value:number):Value|null;
export function record(system:System,value:unknown):SavedRating|null;
export function valueFor(saved:SavedRating|null,system:System):Value|null;
export function format(system:System,value:Value|null|undefined):string;
export function average(sumUnits:number,count:number):Average|null;
