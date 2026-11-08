import type {Catalog} from './piano-lesson-parts';
import type {Pin} from './piano-lesson-package-update';
export const VERSION:1;
export const DATABASE:'melodiajest-piano-packages-v1';
export const MAX_CATALOG_BYTES:number;
export const MAX_STRING_BYTES:number;
export const MAX_DEPTH:number;
export const MAX_NODES:number;
export const MAX_ARCHIVE_BYTES:number;
export const MAX_RECOVERY_BYTES:number;
export interface Candidate {readonly active:Pin;readonly catalog:Catalog}
export interface Snapshot extends Candidate {
 readonly format:'melodiajest-piano-package-state-v1';
 readonly revision:number;readonly operationId:string;
}
declare const changeBrand:unique symbol;
export interface Change {
 readonly [changeBrand]:true;readonly version:1;
 readonly fromRevision:number;readonly toRevision:number;readonly active:Pin;
 readonly operationId:string;readonly catalogBytes:number;
}
declare const archiveBrand:unique symbol;
export interface ArchiveChange {readonly [archiveBrand]:true;readonly version:1;readonly archiveId:string;readonly pendingBytes:number}
export interface ArchiveResult {readonly status:'archived'|'replayed';readonly archiveId:string;readonly durability:string}
declare const pendingRestoreBrand:unique symbol;
export interface PendingRestoreChange {readonly [pendingRestoreBrand]:true;readonly version:1;readonly archiveId:string;readonly pendingBytes:number}
export interface PendingRestoreResult {readonly status:'restored'|'replayed';readonly archiveId:string;readonly durability:string}
declare const recoveryImportBrand:unique symbol;
export interface RecoveryImportChange {readonly [recoveryImportBrand]:true;readonly version:1;readonly database:string;readonly sourceRevision:number;readonly bytes:number}
export interface RecoveryImportResult {readonly status:'imported'|'replayed';readonly sourceRevision:number;readonly bytes:number;readonly durability:string}
export interface Store {
 read():Promise<Readonly<Snapshot>|null>;
 /** Expected must be this store instance's actual read/committed snapshot. Package validation is a separate prerequisite. */
 prepare(expected:Readonly<Snapshot>|null,candidate:Candidate):Change;
 /** Durably stages a private draft without replacing current/previous/receipt. Another pending operation blocks writes. */
 stage(change:Change):Promise<{readonly status:'staged'|'replayed';readonly operationId:string;readonly durability:string}>;
 /** Reopens a validated pending draft as an opaque local change. Never commits automatically; stale/future data is preserved. */
 recoverPending():Promise<Change|null>;
 /** Resolves only on native transaction complete; comparison/current/previous/receipt share one readwrite scope. */
 commit(change:Change):Promise<{readonly status:'committed'|'replayed';readonly current:Readonly<Snapshot>;readonly durability:string}>;
 /** Captures pending plus current/previous/receipt without applying it. A single archive slot cannot be overwritten. */
 preparePendingArchive():Promise<ArchiveChange|null>;
 /** Atomically archives the captured context and consumes only the exact pending. Current/previous/receipt remain unchanged. */
 archivePending(change:ArchiveChange):Promise<ArchiveResult>;
 /** Read-only preparation for the same database's supported archive. Requires empty pending and unchanged captured working context. */
 preparePendingRestore():Promise<PendingRestoreChange|null>;
 /** Adds only the archived pending after native CAS. Keeps the archive and current/previous/receipt; never activates a catalog. */
 restorePending(change:PendingRestoreChange):Promise<PendingRestoreResult>;
 /** Validates an exact own recovery-v2 export and captures an opaque import. Only an empty same-name destination is accepted. No payload is written. */
 prepareRecoveryImport(text:string):Promise<RecoveryImportChange>;
 /** Explicit atomic add-only import after another empty-destination check. Restores the file's working state; pending/archives never resume automatically. */
 importRecovery(change:RecoveryImportChange):Promise<RecoveryImportResult>;
 /** Private v1 export, or v2 when an archive is present. Do not log/send it automatically. Does not modify or repair storage. */
 exportRecovery():Promise<string>;
 close():void;
}
export function validateCandidate(value:unknown):Candidate;
export function create(options:{readonly indexedDB:IDBFactory;readonly name?:string;readonly id?:()=>string}):Store;
