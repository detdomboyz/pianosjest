import type {ArchiveChange,ArchiveResult} from './piano-lesson-package-store';
import type {Store} from './piano-lesson-package-store';
import type {Controller} from './piano-lesson-package-controller';
declare const store:Store,controller:Controller;
async function use(){
 const plan:ArchiveChange|null=await store.preparePendingArchive();
 if(plan){const result:ArchiveResult=await store.archivePending(plan);const id:string=result.archiveId;void id;}
 const owned=await controller.preparePendingArchive();if(owned)await controller.commitPendingArchive(owned);
 // @ts-expect-error A serialized shape is not the store's opaque capability.
 await store.archivePending({version:1,archiveId:'fake',pendingBytes:1});
 // @ts-expect-error Archiving never returns a newly committed current catalog.
 const current=(await controller.commitPendingArchive(owned!)).current;
 // @ts-expect-error Private catalog fields are absent from archive metadata.
 const catalog=owned!.catalog;
 void current;void catalog;
}
void use;
