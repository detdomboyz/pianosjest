import * as S from './piano-browser-checkpoint-store';
import * as C from './piano-browser-checkpoint-candidate';
async function check(db:IDBFactory,subtle:SubtleCrypto,storage:Storage){
 const b=C.create({subtle}),t=await b.prepareFrom(storage),s=S.create({indexedDB:db,subtle}),receipt=await s.save(b.readCandidate(t));
 const complete:false=receipt.completeCopy;const result=await s.read(receipt.id);if(result){const raw:string|null|undefined=result.candidate.persisted[0].status==='observed'?result.candidate.persisted[0].raw:undefined;void raw;}
 // @ts-expect-error metadata tokens have no private candidate values
 await s.save(t);
 // @ts-expect-error candidate store does not restore or mutate an application
 s.apply(result);
 // @ts-expect-error no eviction/deletion operation is exposed
 s.delete(receipt.id);
 // @ts-expect-error no complete backup is asserted
 const full:true=complete;
 s.close();b.close();void full;
}
function ambiguous(error:S.StoreError){if(error.code==='UNCONFIRMED'){const maybe:boolean=error.writeMayHaveCommitted;void maybe;}}
void ambiguous;
void check;
