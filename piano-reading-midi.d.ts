export as namespace PianoReadingMidi;
export interface MidiNote {readonly type:'note-on'|'note-off';readonly midi:number;readonly source:'midi'}
export function decode(data:ArrayLike<number>|null|undefined):MidiNote|null;
export interface Connection {ports():{id:string;name:string}[];heldCount():number;connect():Promise<{id:string;name:string}[]>;select(id:string):Promise<void>;dispose():void}
/** Requests access only from connect(); never requests SysEx, outputs or audio. */
export function create(options?:{requestAccess?:(options:{sysex:false})=>Promise<MIDIAccess>;onInput?:(event:MidiNote)=>void;onInterrupted?:()=>void;onPorts?:(ports:{id:string;name:string}[])=>void}):Connection;
