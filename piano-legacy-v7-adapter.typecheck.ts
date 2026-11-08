import * as Reader from './piano-legacy-v7-adapter';
import type {Loaded} from './piano-lesson-package-loader';
import type {Controller} from './piano-lesson-package-controller';
declare const source:Loaded,controller:Controller,storage:Storage;
const decode=Reader.create({source});
controller.prepareLegacyV7({source,storage,decode});
controller.prepareLegacyV7({source,storage});
const catalog=decode('{"version":7}');
const version:7=catalog.version;
// @ts-expect-error An arbitrary pin is not the verified loader capability.
Reader.create({source:{active:{release:'23.5.49'}}});
// @ts-expect-error Raw strings and null are the only accepted source values.
decode({version:7});
// @ts-expect-error The decoder returns a synchronous catalog, not a Promise.
const asynchronous:Promise<unknown>=decode(null);
void version;
