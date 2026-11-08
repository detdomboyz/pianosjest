import type {Client} from './service-client';
import type {CourseLesson,IssuedAttempt,Grade,MidiEvent,Attempt} from './game-service';
export as namespace MelodiaLearning;
export const KEY:'melodiajest-learning-pending-v1';
export interface Pending {readonly version:1;readonly ownerId:string;readonly writerId:string;readonly kind:'starting'|'ready'|'submitting';readonly expiredConfirmed?:boolean;readonly attempt?:IssuedAttempt;readonly input:{readonly lessonId:string;readonly musicVersion:string;readonly editionVersion:string;readonly mode:'challenge'|'memory';readonly nonce:string;readonly operationId:string};readonly submission?:{readonly nonce:string;readonly events:readonly MidiEvent[];readonly observedUntil:number;readonly observationInterrupted:boolean}}
export interface Status {readonly pending:Pending|null;readonly busy:boolean;readonly ready:boolean;readonly captureOrigin:number|null}
export interface Controller {start(lesson:CourseLesson,mode:'challenge'|'memory'):Promise<IssuedAttempt>;submit(input:{events:readonly MidiEvent[];observedAt:number;interrupted:boolean}):Promise<Grade>;recover():Promise<{attempt?:IssuedAttempt;result?:Grade;expired?:true}|null>;cancel():Promise<Attempt|undefined>;read():Pending|null;status():Status;exportPending():string;releaseOwnership():void}
export function create(options:{client:Client;crypto?:Crypto;clock?:()=>number;locks?:Pick<LockManager,'request'>|null;requireLocks?:boolean;onChange?:(status:Status)=>void}):Controller;
