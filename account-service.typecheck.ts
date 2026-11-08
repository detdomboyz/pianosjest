import * as Client from './service-client';
import * as Personal from './catalog-personalization';
declare const client:Client.Client;
declare const source:Personal.Snapshot;
const current:Client.Status=client.status();
const own:Promise<Client.StoredObject>=client.getObject('catalog');
const delta:Personal.Personal=Personal.create(source,source,{baseRelease:'23.5.61'});
const restored:Personal.Result=Personal.apply(source,delta);
if(restored.ok){const count:number=restored.snapshot.lessons.length;void count;}
// @ts-expect-error An arbitrary owner is not an API option: the session owns data.
void client.api('/catalog',{ownerId:'somebody-else'});
// @ts-expect-error SSO is prepared separately, not an implemented login method.
void client.auth('sso',{});
void current;void own;
