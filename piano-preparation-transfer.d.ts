import type {HydratedLesson,Requirement,Readiness} from './piano-preparation';
export as namespace PianoPreparationTransfer;
export const MAX_CHARS:32000000;
export const MAX_DEPTH:64;
export const MAX_NODES:2000000;
export const MAX_RECOVERY_ENTRIES:4096;
export interface JournalSummary {readonly available:boolean;readonly storedEntries:number;readonly recoveryEntries:number;readonly uniqueEntries:number;readonly duplicateCopies:number;readonly currentEntries:number;readonly archivedEntries:number;readonly capacityExceeded:boolean}
export interface LegacySummary {readonly records:number;readonly progressRecords:number;readonly privateRecords:number;readonly archivedEditions:number;readonly opaqueArchives:number;readonly receipts:number}
interface Base {readonly sourceVersion:1|2|null;readonly sourceCharacters:number;readonly canWrite:false}
export type Inspection=(Base&{readonly status:'invalid'|'unsupported';readonly code:string})|(Base&{readonly status:'valid'|'incomplete';readonly code:null;readonly completeCopy:boolean;readonly archivePending:boolean;readonly scopes:readonly ('whole'|'fragments'|'legacy')[];readonly whole:JournalSummary;readonly fragments:JournalSummary|null;readonly legacy:LegacySummary|null;readonly legacyRecovery:{readonly operations:number;readonly uniqueOperations:number;readonly applied:false;readonly grantsPreparation:false}|null;readonly readiness:Readiness['requirements'];readonly localMidiDataOnly:true;readonly teacherReviewed:false;readonly physicalPerformanceVerified:false});
/** No storage, network, counters or catalog writes. Original input remains with the caller. */
export function inspect(raw:string,options:{readonly lessons:readonly HydratedLesson[];readonly now:number}):Inspection;
export function currentRequirements(lessons:readonly HydratedLesson[]):readonly Requirement[];
/** Strict bounded JSON, shared by the transaction/archive reader. */
export function decode(raw:string):unknown;
/** Compare already decoded JSON values; never use with cyclic or unvalidated objects. */
export function canonical(value:unknown):string;
