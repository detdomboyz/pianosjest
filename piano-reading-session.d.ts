import type {Document} from './music-document';
import type {Notation} from './piano-staff-view';
export as namespace PianoReadingSession;
export const VERSION:1;
export const SCOPE:'piano-staff-reading';
export type Reason='requested-practice'|'already-exposed'|'published-example'|'answer'|'names'|'fingering'|'audio-replay'|'text-alternative'|'retry'|'interrupted'|'non-midi-input'|'duplicate-note-on'|'overlap';
export const REASONS:readonly Reason[];
export interface Item {readonly schemaVersion:1;readonly instrument:'piano';readonly itemId:string;readonly itemVersion:string;readonly lessonId:string;readonly music:Document;readonly notation:Notation}
export interface Identity {readonly instrument:'piano';readonly lessonId:string;readonly itemId:string;readonly itemVersion:string;readonly documentId:string;readonly documentRevision:string;readonly partId:string}
export interface Result {readonly schemaVersion:1;readonly scope:'pitch-order-only';readonly executionVerified:false;readonly outcome:'first-pitch-order-matched'|'first-needs-repeat'|'practice-only';readonly matched:boolean;readonly reasons:readonly Reason[];readonly played:readonly number[];readonly finishedAt:string}
export interface Reservation {readonly id:string;readonly identity:Identity;readonly contentKey:string;readonly openedAt:string;readonly mode:'first'|'practice';readonly reasons:readonly Reason[];readonly result:Result|null}
/** Own storage scope. No memory, finger, timing or course completion credit. */
export interface History {readonly schemaVersion:1;readonly scope:'piano-staff-reading';readonly revision:number;readonly exposures:readonly {readonly contentKey:string;readonly openedAt:string}[];readonly attempts:readonly Reservation[]}
/** Ephemeral answer data: never render expected pitches/names into first-mode DOM. */
export interface Session {readonly schemaVersion:1;readonly phase:'awaiting-save'|'active'|'finished';readonly reservation:Reservation;readonly expected:readonly number[];readonly played:readonly number[];readonly held:readonly number[];readonly reasons:readonly Reason[]}
export interface OpenOptions {readonly sessionId:string;readonly mode:'first'|'practice';readonly now:string;readonly publishedExamples:readonly Item[]}
export interface Change {readonly history:History;readonly session:Session}
export function emptyHistory():History;
/** Throws on corrupted/unsupported history; null alone means a missing storage key. */
export function parseHistory(raw:string|null):History;
export function validateHistory(history:unknown):History;
export function contentKey(item:Item):string;
/** Caller must supply every published demonstration and transfer; null means practice only. */
export function selectUnseen(history:History,bank:readonly Item[],publishedExamples:readonly Item[]):Item|null;
export function open(history:History,item:Item,options:OpenOptions):Change;
/** Call only after successful durable write and readback. */
export function activate(session:Session,savedHistory:History):Session;
export function input(session:Session,event:{readonly type:'note-on'|'note-off';readonly midi:number;readonly source:'midi'|'pointer'|'keyboard'}):Session;
export function assist(session:Session,reason:Reason):Session;
export function rememberAssistance(history:History,session:Session):Change;
export function finish(history:History,session:Session,options:{readonly now:string}):Change&{readonly result:Result};
