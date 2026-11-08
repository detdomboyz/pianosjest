import * as Owner from './piano-legacy-checkpoint-owner';
import * as Candidate from './piano-browser-checkpoint-candidate';
declare const storage:Storage,locks:LockManager,subtle:SubtleCrypto;
const owner=Owner.create({storage,locks,now:()=>Date.now()});
const token=owner.prepareCheckpoint(),observation=owner.readCheckpoint(token) satisfies Candidate.ComponentInput;
const complete:false=token.completeCopy;
const current:boolean=owner.isCurrent(token);
const parsed:Owner.Envelope=JSON.parse(observation.raw);
void [complete,current,parsed];
void Candidate.create({subtle}).prepareFrom(storage,[observation]);
// @ts-expect-error Serialized metadata is not the owner-bound token.
owner.readCheckpoint({format:Owner.FORMAT,version:1,componentId:'legacy-progress',generation:0,sourceGeneration:0,pendingCount:0,confirmedAvailable:false,codeUnits:0,completeCopy:false});
// @ts-expect-error A full browser copy is not proven by one owner.
const full:true=token.completeCopy;
// @ts-expect-error Other owners are outside this contract.
const wrong:'catalog-state'=observation.id;
void [full,wrong];
