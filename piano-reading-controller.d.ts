import type {Bank,BankItem} from './piano-reading-bank';
import type {Store} from './piano-reading-store';
import type {Clef} from './piano-staff-view';
import type {Reason,Result} from './piano-reading-session';
export as namespace PianoReadingController;
export interface Snapshot {readonly phase:'ready'|'saving'|'active'|'finished'|'blocked'|'unsaved'|'exhausted';readonly busy:boolean;readonly code:string|null;readonly item:BankItem;readonly mode:'study'|'first';readonly attemptMode:'first'|'practice';readonly reasons:readonly Reason[];readonly captured:number;readonly held:number;readonly remaining:number;readonly result:Result|null;readonly exportText:string}
export interface Controller {snapshot():Snapshot;refresh():Promise<void>;start(kind:'first'|'practice'|'variation'):Promise<void>;input(event:{type:'note-on'|'note-off';midi:number;source:'midi'|'pointer'|'keyboard'}):void;reveal():Promise<void>;interrupt():Promise<void>;finish():Promise<void>;cancel():Promise<void>;exportHistory():Promise<void>;importHistory(raw:string):Promise<void>}
export function create(options:{store:Store;bank:Bank;clef:Clef;now:()=>string;sessionId:()=>string;onChange?:(snapshot:Snapshot)=>void}):Controller;
