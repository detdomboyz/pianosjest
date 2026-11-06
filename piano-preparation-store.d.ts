import type {Requirement,Attempt} from './piano-preparation';
export as namespace PianoPreparationStore;
export const STORAGE_KEY:'music-preparation-piano-v1';
export const LOCK_NAME:'melodiajest:piano-preparation-v1';
export const SCOPE:'piano-whole-preparation-v1';
export const MAX_CHARS:2000000;
export const MAX_ENTRIES:512;
export interface Entry {readonly requirement:Requirement;readonly attempt:Attempt}
export type Scope=typeof SCOPE|'piano-fragment-preparation-v1';
export interface History<S extends Scope=typeof SCOPE> {readonly schemaVersion:1;readonly scope:S;readonly revision:number;readonly entries:readonly Entry[];readonly [key:string]:unknown}
export type Result<S extends Scope=typeof SCOPE>={readonly status:'ready'|'saved';readonly history:History<S>;readonly raw:string|null}|{readonly status:'blocked'|'unsaved';readonly code:string;readonly raw?:string|null};
export interface Store<S extends Scope=typeof SCOPE> {read(options:{readonly now:number}):Promise<Result<S>>;append(entry:Entry,options:{readonly now:number}):Promise<Result<S>>}
export interface Dependencies {readonly storage:{getItem(key:string):string|null;setItem(key:string,value:string):void};readonly locks?:{request<T>(name:string,options:{mode:'exclusive'},work:(lock:unknown)=>T|Promise<T>):Promise<T>}}
export interface ScopedStore<S extends Scope> {readonly STORAGE_KEY:string;readonly LOCK_NAME:string;readonly SCOPE:S;empty():History<S>;parse(raw:string|null,now:number):History<S>;validate(history:unknown,now:number):History<S>;create(dependencies:Dependencies):Store<S>}
export function empty():History;
export function parse(raw:string|null,now:number):History;
export function validate(history:unknown,now:number):History;
export function create(dependencies:Dependencies):Store;
/** Separate key/lock/range; no migration or access to whole/legacy journals. */
export const fragments:ScopedStore<'piano-fragment-preparation-v1'>&{readonly STORAGE_KEY:'music-preparation-fragments-piano-v1';readonly LOCK_NAME:'melodiajest:piano-preparation-fragments-v1'};
