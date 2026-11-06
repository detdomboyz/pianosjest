import type {Document} from './music-document';
export as namespace PianoStaffView;
export const VERSION:1;
export type Clef='treble'|'bass';
/** Explicit, revision-scoped notation; no automatic MIDI-to-spelling conversion. */
export interface Notation {readonly documentRevision:string;readonly partId:string;readonly clef:Clef;readonly spelling:readonly {readonly noteId:string;readonly step:'C'|'D'|'E';readonly octave:number;readonly alter:0}[]}
export interface StaffNote {readonly noteId:string;readonly partId:string;readonly midi:number;readonly label:string;readonly staffPosition:number;readonly ledgerPositions:readonly number[];readonly startBeat:number;readonly durationBeats:number}
export interface View {readonly schemaVersion:1;readonly status:'ready'|'limited'|'unsupported';readonly documentId:string|null;readonly documentRevision:string|null;readonly partId:string|null;readonly clef:Clef|null;readonly notes:readonly StaffNote[];readonly warnings:readonly {readonly code:string;readonly message:string;readonly noteId?:string}[]}
export function project(document:Document,notation:Notation):View;
