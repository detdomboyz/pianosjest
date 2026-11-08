import type {Catalog} from './piano-lesson-parts';
import type {Loaded} from './piano-lesson-package-loader';
import type {Plan,Pin} from './piano-lesson-package-update';
import type {Copies} from './piano-legacy-catalog-copy';
import type {Store,Snapshot,Change,ArchiveChange,ArchiveResult,PendingRestoreChange,PendingRestoreResult,RecoveryImportChange,RecoveryImportResult} from './piano-lesson-package-store';
export const VERSION:1;
declare const viewBrand:unique symbol;
export interface View extends Snapshot {readonly [viewBrand]:true}
export interface Status {readonly phase:'idle'|'saving'|'saved'|'failed'|'legacy-prepared'|'pending-archive-prepared'|'pending-archived'|'pending-restore-prepared'|'pending-restored'|'recovery-import-prepared'|'recovery-imported';readonly code:string|null;readonly confirmedRevision:number|null;readonly stagedOperationId:string|null;readonly legacyCopyId?:string;readonly pendingArchiveId?:string;readonly recoveryImportBytes?:number}
declare const legacyPlanBrand:unique symbol;
export interface LegacyPreparation {readonly [legacyPlanBrand]:true;readonly version:1;readonly legacyCopyId:string;readonly active:Pin;readonly missing:boolean}
export interface Result {readonly status:'committed'|'replayed';readonly current:View;readonly durability:string}
export interface Controller {
 read():Promise<View|null>;
 /** Seed an already prepared v7 snapshot. Original legacy-byte backup and legacy writers are a separate migration stage. */
 initializeV7(source:Loaded,catalog:Catalog):Promise<Result>;
 /** Preserves the original first, verifies readback/current source, then captures a synchronous adapter result. Never stages/commits or activates v7. */
 prepareLegacyV7(input:{readonly source:Loaded;readonly storage:Pick<Storage,'getItem'>;readonly decode?:(raw:string|null)=>Catalog}):Promise<LegacyPreparation>;
 /** Explicit private draft export. Rechecks the source; original/foreign/JSON-copied tokens are not interchangeable. */
 exportLegacyPreparation(plan:LegacyPreparation):Promise<string>;
 /** Copies the whole candidate synchronously before waiting. All proposed app writers must use this one boundary. */
 writeCatalog(expected:View,catalog:Catalog):Promise<Result>;
 prepareUpdate(input:{readonly previous:Loaded;readonly incoming:Loaded}):Promise<Plan>;
 commitUpdate(proposal:Plan):Promise<Result>;
 /** No commit occurs during read/prepareRecovery. Resume requires an explicit second action. */
 prepareRecovery():Promise<Change|null>;
 commitRecovery(change:Change):Promise<Result>;
 /** Read-only preparation. Does not replace current or consume pending. */
 preparePendingArchive():Promise<ArchiveChange|null>;
 /** Explicit second action; serialized with other controller writes. Result confirms the archive, not a catalog save. */
 commitPendingArchive(change:ArchiveChange):Promise<ArchiveResult>;
 /** Prepare only a supported same-database archive whose original working context still matches. Does not write pending/current. */
 preparePendingRestore():Promise<PendingRestoreChange|null>;
 /** Explicit second action restores pending, retaining the archive. Activation still requires prepareRecovery/commitRecovery. */
 commitPendingRestore(change:PendingRestoreChange):Promise<PendingRestoreResult>;
 /** Read-only file validation and opaque preparation for an empty destination. Does not activate the file's working state. */
 prepareRecoveryImport(text:string):Promise<RecoveryImportChange>;
 /** Explicit second action restores the whole file into the empty store. It does not resume drafts or report an ordinary catalog save. */
 commitRecoveryImport(change:RecoveryImportChange):Promise<RecoveryImportResult>;
 /** Private data, only on explicit user request; never automatically sent or logged. */
 exportRecovery():Promise<string>;
 status():Status;
 /** Does not cancel a transaction already committing; its Promise remains authoritative. */
 close():void;
}
export function create(config:{readonly store:Store;readonly subtle:Pick<SubtleCrypto,'digest'>;readonly onChange?:(status:Status)=>void;readonly legacyCopies?:Pick<Copies,'prepareFrom'|'commit'|'read'>}):Controller;
