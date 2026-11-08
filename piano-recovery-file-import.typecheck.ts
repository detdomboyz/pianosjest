import type {Store,RecoveryImportChange,RecoveryImportResult,PendingRestoreChange} from './piano-lesson-package-store';
import type {Controller} from './piano-lesson-package-controller';
declare const store:Store,controller:Controller,pending:PendingRestoreChange;
async function use(text:string){
 const plan:RecoveryImportChange=await store.prepareRecoveryImport(text);
 const result:RecoveryImportResult=await store.importRecovery(plan);const bytes:number=result.bytes;void bytes;
 const owned=await controller.prepareRecoveryImport(text);await controller.commitRecoveryImport(owned);
 // @ts-expect-error A serialized shape is not an import capability.
 await store.importRecovery({version:1,database:'x',sourceRevision:1,bytes:1});
 // @ts-expect-error Pending restoration and whole-file import are distinct capabilities.
 await controller.commitRecoveryImport(pending);
 // @ts-expect-error Metadata never contains the private catalog.
 const catalog=plan.catalog;
 // @ts-expect-error Import completion does not claim an ordinary catalog save.
 const current=result.current;
 void catalog;void current;
}
void use;
