export as namespace PianoPreparation;
export const VERSION:1;
export const POLICY:'three-clean-one-memory-v1';
export const MAX_LEGACY_CHARS:2000000;
export interface Range {readonly kind:'whole'|'fragment';readonly firstStep:number;readonly lastStep:number}
export interface Step {readonly midis:readonly number[];readonly startBeat:number;readonly durationBeats:number}
export interface Adaptation {readonly version:1;readonly id:string;readonly kind:'project-training-adaptation';readonly sourceBpm:number}
export interface FragmentPlan {readonly lessonId:string;readonly firstStep:number;readonly lastStep:number;readonly goal:string;readonly requiredBeforeAssessment:true;readonly adaptation?:{readonly version:1;readonly id:string;readonly kind:'project-training-adaptation';readonly targetBpm:number;readonly rationale:string}}
export interface Requirement {readonly key:string;readonly lessonId:string;readonly assessmentVersion:number;readonly fingerprint:string;readonly range:Range;readonly steps:readonly Step[];readonly targetBpm:number;readonly adaptation?:Adaptation;readonly articulation:'standard'|'nonlegato'|'legato'|'staccato';readonly timingPrecision?:'beat-boundary-v1'|'beat-boundary-v2';readonly ending?:{readonly version:1;readonly endBeat:number}}
export interface Contract {readonly schemaVersion:1;readonly kind:'piano-preparation-contract';readonly planId:string;readonly policy:typeof POLICY;readonly requirements:readonly Requirement[]}
/** The actual local runtime assessment dialect; raw v7 catalog JSON must be hydrated first. */
export interface HydratedLesson {readonly id:string;readonly pattern:string;readonly rhythm:{readonly practiceBpm:number;readonly steps:readonly {readonly stepIndex:number;readonly sourceStartMs:number;readonly sourceDurationMs:number;readonly startBeat:number;readonly durationBeats:number;readonly [key:string]:unknown}[];readonly [key:string]:unknown};readonly [key:string]:unknown}
export interface Plan {readonly id:string;readonly hand:'right'|'left';readonly requires:readonly string[];readonly preparationFragments?:readonly FragmentPlan[]}
export interface Event {readonly type:'on'|'off';readonly midi:number;readonly at:number;readonly source?:'midi'|'pointer'|'keyboard'}
/** Local data, not signed device/teacher evidence; a future capture adapter must freeze assistance and mode. */
export interface Attempt {readonly schemaVersion:1;readonly attemptId:string;readonly requirementKey:string;readonly capturedAt:number;readonly bpm:number;readonly observedUntil:number;readonly mode:'practice'|'challenge'|'memory';readonly assisted:boolean;readonly observationInterrupted:boolean;readonly timedOut:boolean;readonly errors:number;readonly events:readonly Event[]}
export interface Assessment {readonly version:1;readonly clean:boolean;readonly reasons:readonly string[];readonly scope:string;readonly [key:string]:unknown}
export interface AttemptResult {readonly status:'invalid'|'unrelated-or-stale'|'rejected'|'matched';readonly code:string|null;readonly assessment?:Assessment}
export interface Readiness {readonly schemaVersion:1;readonly planId:string;readonly status:'invalid-evidence'|'met'|'pending';readonly code:string|null;readonly requirements:readonly {readonly key:string;readonly lessonId:string;readonly range:Range;readonly status:'met'|'pending';readonly cleanTakes:number;readonly memory:boolean;readonly retained:boolean}[];readonly ignored:readonly {readonly attemptId:string;readonly status:string;readonly code?:string|null}[];readonly scope:'local-midi-data-only';readonly fingeringVerified:false;readonly physicalPerformanceVerified:false;readonly teacherReviewed:false}
export interface LegacyInspection {readonly schemaVersion:1;readonly kind:'legacy-piano-progress-inspection';readonly status:'missing'|'invalid'|'unsupported'|'read-only';readonly raw:string|null;readonly records:readonly {readonly lessonId:string;readonly status:'invalid-record'|'unknown-lesson'|'needs-hydration'|'matching-summary'|'other-edition'|'unsupported-version';readonly preparationCredit:false}[];readonly grantsPreparation:false}
export function compile(plan:Plan,lessons:readonly HydratedLesson[]):Contract;
export function assessAttempt(requirement:Requirement,attempt:unknown,options:{readonly now:number}):AttemptResult;
export function evaluate(contract:Contract,attempts:readonly unknown[],options:{readonly now:number}):Readiness;
/** Preserves original JSON byte for byte; never writes/merges legacy storage or grants preparation credit. */
export function inspectLegacy(raw:string|null,lessons:readonly HydratedLesson[]):LegacyInspection;
