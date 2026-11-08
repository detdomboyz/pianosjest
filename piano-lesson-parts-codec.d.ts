import type {Manifest,Topic} from './piano-lesson-parts';
export const VERSION:1;
export const MAX_PART_BYTES:number;
export const MAX_MANIFEST_BYTES:number;
/** Data validation only. The caller must verify the exact byte SHA256 first. */
export function validateManifest(value:unknown):Manifest;
export function readManifestData(bytes:Uint8Array):Manifest;
export function readPartData(manifest:Manifest,key:string,bytes:Uint8Array):Topic;
