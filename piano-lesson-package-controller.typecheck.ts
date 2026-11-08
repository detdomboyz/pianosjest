import {create,View,Status,Result} from './piano-lesson-package-controller';
import type {Store} from './piano-lesson-package-store';
import type {Loaded} from './piano-lesson-package-loader';
import type {Copies} from './piano-legacy-catalog-copy';
declare const store:Store,source:Loaded,incoming:Loaded;
const controller=create({store,subtle:crypto.subtle,onChange:(status:Status)=>status.phase});
async function check(){
 const initial:Result=await controller.initializeV7(source,source.catalog);
 const view:View=initial.current;
 await controller.writeCatalog(view,view.catalog);
 const proposal=await controller.prepareUpdate({previous:source,incoming});
 await controller.commitUpdate(proposal);
 const pending=await controller.prepareRecovery();if(pending)await controller.commitRecovery(pending);
 const exported:string=await controller.exportRecovery();
 // @ts-expect-error A raw store snapshot is not a controller view.
 await controller.writeCatalog((await store.read())!,source.catalog);
 // @ts-expect-error Progress remains separate from the catalog candidate.
 await controller.writeCatalog(view,{...view.catalog,progress:{}});
 // @ts-expect-error View data is immutable.
 view.catalog.lessons.push(source.catalog.lessons[0]);
 return exported;
}
void check;
declare const copies:Copies;
const legacyController=create({store,subtle:crypto.subtle,legacyCopies:copies});
async function legacyCheck(){
 const plan=await legacyController.prepareLegacyV7({source,storage:localStorage,decode:raw=>{void raw;return source.catalog;}});
 const privateDraft:string=await legacyController.exportLegacyPreparation(plan);
 // @ts-expect-error An arbitrary legacy raw string is not a catalog source adapter.
 await legacyController.prepareLegacyV7({source,storage:localStorage,decode:raw=>raw});
 // @ts-expect-error Async transformation is outside the synchronous capture boundary.
 await legacyController.prepareLegacyV7({source,storage:localStorage,decode:async()=>source.catalog});
 // @ts-expect-error A store change is not a prepared legacy capability.
 await legacyController.exportLegacyPreparation((await store.recoverPending())!);
 return privateDraft;
}
void legacyCheck;
