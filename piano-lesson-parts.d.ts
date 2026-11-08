import type {LegacyEntry,JsonValue} from './piano-catalog-adapter';
export const VERSION:1;
export const MAX_PART_BYTES:number;
export const MAX_MANIFEST_BYTES:number;
export interface Source {readonly release:string;readonly webManifestSha256:string}
export interface Theme {readonly id:string;readonly name:string;readonly order:number;readonly [key:string]:JsonValue|undefined}
export interface TrainingEntry extends LegacyEntry {readonly themeId:string;readonly order:number;readonly contentKind:'exercise'}
export interface Catalog {readonly version:7;readonly themes:readonly Theme[];readonly lessons:readonly LegacyEntry[];readonly savedAt?:string}
export interface Descriptor {readonly themeId:string;readonly key:string;readonly sha256:string;readonly bytes:number;readonly lessonIds:readonly string[]}
export interface Manifest {readonly schema:'melodiajest-piano-parts';readonly version:1;readonly instrument:'piano';readonly catalogFormat:7;readonly source:Source;readonly themeOrder:readonly string[];readonly lessonOrder:readonly string[];readonly parts:readonly Descriptor[]}
export interface Topic {readonly schema:'melodiajest-piano-topic';readonly version:1;readonly instrument:'piano';readonly catalogFormat:7;readonly source:Source;readonly theme:Theme;readonly lessons:readonly TrainingEntry[]}
export interface Bundle {readonly manifest:Manifest;readonly manifestBytes:Uint8Array;readonly manifestSha256:string;readonly manifestKey:string;readonly files:ReadonlyMap<string,Uint8Array>}
export function build(snapshot:Catalog,options:Source&{readonly themeIds:readonly string[]}):Bundle;
export function validateManifest(manifest:unknown):Manifest;
export function readManifest(bytes:Uint8Array,expectedSha256:string):Manifest;
export function readPart(manifest:Manifest,key:string,bytes:Uint8Array):Topic;
export function assemble(manifest:Manifest,files:ReadonlyMap<string,Uint8Array>):Catalog;
export function write(bundle:Bundle,outDir:string):{readonly outDir:string;readonly created:number;readonly reused:number;readonly manifestKey:string;readonly manifestSha256:string};
