import type {HydratedLesson,Event,Requirement} from './piano-preparation';
import type {Store,Entry,History,Scope} from './piano-preparation-store';
import type {Recovery as LegacyRecovery} from './piano-progress-store';
export as namespace PianoPreparationCapture;
export const TARGET_IDS:readonly string[];
export interface Snapshot {readonly count:number|null;readonly pendingCount:number;readonly saving:boolean;readonly code:string|null;readonly generation:number}
export interface Input {readonly full:boolean;readonly mode:'practice'|'challenge'|'memory';readonly bpm:number;readonly observedUntil:number;readonly assisted:boolean;readonly observationInterrupted:boolean;readonly timedOut:boolean;readonly errors:number;readonly events:readonly Event[]}
export interface FragmentInput extends Omit<Input,'full'> {readonly full:false;readonly requirement:Requirement}
export interface Legacy {readonly status:'available'|'unavailable';readonly raw:string|null}
export interface Journal<S extends Scope='piano-whole-preparation-v1'> {readonly storageStatus:'ready'|'unavailable';readonly storedHistory:History<S>|null;readonly storedHistoryRaw:string|null;readonly recoveryEntries:readonly Entry[]}
export interface ExportBundle<S extends Scope='piano-whole-preparation-v1'> extends Journal<S> {readonly schemaVersion:1;readonly kind:'melodiajest-preparation-export';readonly legacy:Legacy;readonly completeCopy:boolean}
export interface BaseCapture<S extends Scope> {snapshot():Snapshot;refresh():Promise<unknown>;readiness(requirement:Requirement):{readonly status:'pending'|'met';readonly cleanTakes:number;readonly memory:boolean;readonly retained:boolean};retry():Promise<Snapshot>;settled():Promise<Snapshot>;exportJournal():Promise<Journal<S>&{readonly generation:number}>;exportBundle(readLegacy:()=>string|null):Promise<ExportBundle<S>>}
export interface Capture extends BaseCapture<'piano-whole-preparation-v1'> {capture(lesson:HydratedLesson,input:Input):Promise<unknown>}
export interface FragmentCapture extends BaseCapture<'piano-fragment-preparation-v1'> {capture(lesson:HydratedLesson,input:FragmentInput):Promise<unknown>}
export interface Dependencies<S extends Scope> {readonly store:Store<S>;readonly now:()=>number;readonly id:()=>string;readonly onChange?:(snapshot:Snapshot)=>void}
export interface CombinedBundle {readonly schemaVersion:2;readonly kind:'melodiajest-preparation-export';readonly journals:{readonly whole:Journal;readonly fragments:Journal<'piano-fragment-preparation-v1'>};readonly legacy:Legacy;readonly legacyRecovery?:Omit<LegacyRecovery,'generation'>;readonly transferArchive?:Legacy;readonly completeCopy:boolean}
export function create(dependencies:Dependencies<'piano-whole-preparation-v1'>):Capture;
export function createFragments(dependencies:Dependencies<'piano-fragment-preparation-v1'>):FragmentCapture;
/** Compare returned generations to both current snapshots before showing the copy. */
export function exportCombined(whole:Capture,fragments:FragmentCapture,readLegacy:()=>string|null,readLegacyRecovery?:()=>LegacyRecovery):Promise<{readonly generations:{readonly whole:number;readonly fragments:number;readonly legacy?:number};readonly bundle:CombinedBundle}>;
