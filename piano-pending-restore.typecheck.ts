import type {Store,ArchiveChange,PendingRestoreChange,PendingRestoreResult} from './piano-lesson-package-store';
import type {Controller} from './piano-lesson-package-controller';
declare const store:Store,controller:Controller,archive:ArchiveChange;
async function use(){
 const plan:PendingRestoreChange|null=await store.preparePendingRestore();
 if(plan){const result:PendingRestoreResult=await store.restorePending(plan);const id:string=result.archiveId;void id;}
 const owned=await controller.preparePendingRestore();if(owned)await controller.commitPendingRestore(owned);
 // @ts-expect-error Archive and restore capabilities are not interchangeable.
 await store.restorePending(archive);
 // @ts-expect-error A serialized shape is not a restore capability.
 await controller.commitPendingRestore({version:1,archiveId:'fake',pendingBytes:1});
 // @ts-expect-error Restoring pending never returns an activated current catalog.
 const current=(await store.restorePending(plan!)).current;
 // @ts-expect-error Private catalog data is absent from the metadata token.
 const catalog=owned!.catalog;
 void current;void catalog;
}
void use;
