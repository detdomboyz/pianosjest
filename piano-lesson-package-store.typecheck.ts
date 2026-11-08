import {create,validateCandidate,Candidate,Change,Snapshot} from './piano-lesson-package-store';
declare const source:Candidate;
declare const indexedDB:IDBFactory;
const store=create({indexedDB});
async function apply(){
 const before=await store.read();
 const next:Change=store.prepare(before,validateCandidate(source));
 const staged=await store.stage(next);
 const recovered:Change|null=await store.recoverPending();
 if(recovered)await store.commit(recovered);
 const result=await store.commit(next);
 const snapshot:Readonly<Snapshot>=result.current;
 const exported:string=await store.exportRecovery();
 // @ts-expect-error The commit token must come from this store's prepare.
 await store.commit({version:1,fromRevision:0,toRevision:1,active:source.active,operationId:'fake',catalogBytes:0});
 // @ts-expect-error Progress stays outside catalog persistence.
 store.prepare(before,{...source,progress:{}});
 // @ts-expect-error Source identity is immutable.
 snapshot.active.release='0.0.0';
 // @ts-expect-error A frozen snapshot does not allow catalog array edits.
 snapshot.catalog.lessons.push(source.catalog.lessons[0]);
 return {snapshot,exported,result,staged};
}
void apply;
