import * as Loader from './piano-lesson-package-loader';
const config:Loader.Configuration={baseUrl:'https://melodiajest.ru/lesson-parts/',origin:'https://melodiajest.ru',fetch:(url,init)=>fetch(url,init),subtle:crypto.subtle};
const loader=Loader.create(config);
const pending=loader.load({pin:{release:'23.5.43',manifestSha256:'a'.repeat(64),webManifestSha256:'b'.repeat(64)},signal:new AbortController().signal});
pending.then(result=>{
 const n:number=result.stats.networkBytes;void n;
 // @ts-expect-error Results and pins are readonly.
 result.active.release='23.5.44';
 // @ts-expect-error Public loader does not offer commit/persist.
 loader.commit(result);
});
// @ts-expect-error Cryptography is an explicit dependency.
Loader.create({baseUrl:config.baseUrl,origin:config.origin,fetch:config.fetch});
// @ts-expect-error Source pin must be complete.
loader.load({pin:{release:'23.5.43',manifestSha256:'a'.repeat(64)}});
