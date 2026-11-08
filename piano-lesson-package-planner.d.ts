import type {Catalog} from './piano-lesson-parts';
import type {Pin,Plan} from './piano-lesson-package-update';
import type {Loaded} from './piano-lesson-package-loader';
export const VERSION:1;
export type FailureCode='INPUT'|'LIMIT'|'SOURCE'|'CONFLICT'|'STALE'|'PLAN'|'UNAVAILABLE'|'DIGEST';
export interface PlanError extends Error {readonly name:'LessonPackagePlanError';readonly code:FailureCode}
export interface Input {readonly active:Pin;readonly previous:Loaded;readonly incoming:Loaded;readonly catalog:Catalog}
/** Captures data before awaiting SHA256; only original verified loader results are accepted. */
export function create(config:{readonly subtle:Pick<SubtleCrypto,'digest'>}):{
 readonly prepare:(input:Input)=>Promise<Plan>;
 readonly materialize:(plan:Plan,latestCatalog:Catalog)=>{readonly active:Pin;readonly catalog:Catalog};
};
