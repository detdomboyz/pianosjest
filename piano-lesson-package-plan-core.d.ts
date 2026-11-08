import type {Catalog} from './piano-lesson-parts';
import type {Pin,Plan} from './piano-lesson-package-update';
export const VERSION:1;
export const MAX_CATALOG_BYTES:number;
export const MAX_STRING_BYTES:number;
export const MAX_JSON_NODES:number;
export const MAX_DEPTH:number;
export function compareRelease(a:string,b:string):-1|0|1;
export function validatePin(value:unknown):Pin;
export interface VerifiedInput {readonly source:Pin;readonly catalog:Catalog}
export interface Input {readonly active:Pin;readonly previous:VerifiedInput;readonly incoming:VerifiedInput;readonly catalog:Catalog}
interface Materializer {materialize(plan:Plan,latestCatalog:Catalog):{readonly active:Pin;readonly catalog:Catalog}}
/** Internal policy core: byte verification belongs to each wrapper. */
export function create(options:{readonly hash:(raw:string)=>string}):Materializer&{prepare(input:Input):Plan};
export function create(options:{readonly hash:(raw:string)=>PromiseLike<string>}):Materializer&{prepare(input:Input):Promise<Plan>};
