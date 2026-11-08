import type {Loaded} from './piano-lesson-package-loader';
import type {Catalog} from './piano-lesson-parts';
export const VERSION:1;
export const MAX_BYTES:number;
/** Pure reader of an existing current-v7 source. Call only after durable raw-copy/readback. */
export function create(config:{readonly source:Loaded}):(raw:string|null)=>Catalog;
