export as namespace MelodiaService;
export interface User {readonly id:string;readonly username:string;readonly displayName:string;readonly createdAt:number}
export interface Status {readonly user:User|null;readonly initialized:boolean;readonly locked:boolean;readonly notice:string;readonly pending:boolean;readonly saving:boolean}
export interface StoredObject {readonly revision:number;readonly raw:string|null;readonly sha256?:string|null;readonly updatedAt?:number|null}
export interface Session {readonly serviceVersion:1;readonly user:User|null;readonly csrfToken:string;readonly recoveryCode?:string;readonly sso:{readonly enabled:false;readonly linking:'explicit-authenticated-link'};readonly personalProgress:'account-scoped-browser'|'database-and-versioned-browser-history'}
export interface APIOptions {readonly method?:'GET'|'POST'|'PUT';readonly data?:unknown;readonly publicRequest?:boolean}
export interface Client {
  api<T=unknown>(route:string,options?:APIOptions):Promise<T>;
  init():Promise<Status>;
  auth(kind:'register'|'login'|'recover'|'password',data:unknown):Promise<Session>;
  logout():Promise<Session>;
  checkSession():Promise<void>;
  getObject(kind:'catalog'|'preferences'):Promise<StoredObject>;
  saveObject(kind:'catalog'|'preferences',raw:string):Promise<StoredObject>;
  requireUser():User;
  readonly storage:{getItem(key:string):string|null;setItem(key:string,value:string):void};
  status():Status;
  pendingExport():string;
  readonly UI_KEY:'piano-blind-trainer-ui-v20';
}
export function create(options:{fetch:typeof fetch;storage:Pick<Storage,'getItem'|'setItem'>;onStatus?:(status:Status)=>void;onAccountChange?:(status:Status)=>void;timeoutMs?:number;locks?:Pick<LockManager,'request'>|null;channelFactory?:(()=>Pick<BroadcastChannel,'onmessage'|'postMessage'>)|null}):Client;
export const API:'/api/service/v1';
export const UI_KEY:'piano-blind-trainer-ui-v20';
