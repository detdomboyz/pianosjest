import * as Candidate from './piano-browser-checkpoint-candidate';
declare const subtle:SubtleCrypto,storage:Storage;
const builder=Candidate.create({subtle});
async function run(){
 const token=await builder.prepareFrom(storage,[{id:'legacy-progress',status:'observed',raw:'opaque pending',generation:1}]);
 const incomplete:false=token.completeCopy;void incomplete;
 const candidate=builder.readCandidate(token);
 // @ts-expect-error An explicit private snapshot is not an opaque prepared token.
 builder.readCandidate(candidate);
 for(const value of candidate.persisted)if(value.status==='observed'){const raw:string|null=value.raw;void raw;}
 // @ts-expect-error Complete recovery is unavailable in this stage.
 const complete:true=candidate.completeCopy;void complete;
 // @ts-expect-error Raw strings must not be normalized to objects.
 await builder.prepareFrom(storage,[{id:'catalog-state',status:'observed',raw:{},generation:1}]);
 // @ts-expect-error Unknown components are explicit unsupported work, not silently added keys.
 await builder.prepareFrom(storage,[{id:'other',status:'unavailable',reason:'UNSUPPORTED'}]);
 // @ts-expect-error Candidate snapshots are immutable.
 candidate.persisted.push({key:Candidate.KEYS[0],status:'observed',raw:null,digest:'',codeUnits:0});
 // @ts-expect-error Metadata cannot forge an opaque token.
 builder.readCandidate({format:Candidate.FORMAT,id:token.id});
}
void run;
