import type {Catalog,Source} from './piano-lesson-parts';
export const VERSION:1;
export const MAX_CATALOG_BYTES:number;
export const MAX_STRING_BYTES:number;
export const MAX_JSON_NODES:number;
export const MAX_DEPTH:number;
export interface Pin extends Source {readonly manifestSha256:string}
export interface PackageInput {readonly pin:Pin;readonly manifestBytes:Uint8Array;readonly files:ReadonlyMap<string,Uint8Array>}
export interface Input {readonly active:Pin;readonly previous:PackageInput;readonly incoming:PackageInput;readonly catalog:Catalog}
export type ConflictKind='missing-theme'|'missing-lesson'|'theme-edited'|'lesson-edited';
export interface Conflict {readonly kind:ConflictKind;readonly id:string}
declare const planBrand:unique symbol;
export interface Plan {
 readonly [planBrand]:true;
 readonly version:1;readonly status:'ready'|'unchanged'|'blocked';readonly from:Pin;readonly to:Pin;
 readonly baseCatalogSha256:string;
 readonly changedLessonIds:readonly string[];readonly changedThemeIds:readonly string[];
 readonly placementOverrides:readonly {readonly kind:'theme'|'lesson';readonly id:string}[];
 readonly conflicts:readonly Conflict[];
}
/** Only three bounded numeric release components are supported in this phase. */
export function compareRelease(a:string,b:string):-1|0|1;
/** Verifies all package bytes and returns a frozen in-memory proposal. No storage is read/written. */
export function prepare(input:Input):Plan;
/** Refuses conflicts, forged plans or a changed local catalog. Does not persist or commit to the app. */
export function materialize(plan:Plan,latestCatalog:Catalog):{readonly catalog:Catalog;readonly active:Pin};
