import * as Planner from './piano-lesson-package-planner';
import * as Loader from './piano-lesson-package-loader';
import * as Store from './piano-lesson-package-store';
import type {Catalog} from './piano-lesson-parts';
import type {Pin,Plan} from './piano-lesson-package-update';
declare const pin:Pin;
declare const catalog:Catalog;
declare const loaded:Loader.Loaded;
declare const expected:Readonly<Store.Snapshot>;
declare const store:ReturnType<typeof Store.create>;
const planner=Planner.create({subtle:crypto.subtle});
async function propose():Promise<Plan>{return planner.prepare({active:pin,previous:loaded,incoming:Loader.requireVerified(loaded),catalog});}
async function persist(){const plan=await propose();const candidate=planner.materialize(plan,catalog);return store.commit(store.prepare(expected,candidate));}
void persist;
// @ts-expect-error A plain catalog is not an authenticated loader result.
const forged:Loader.Loaded={active:pin,catalog,stats:loaded.stats};
// @ts-expect-error Preparing is asynchronous in the browser.
const synchronous:Plan=planner.prepare({active:pin,previous:loaded,incoming:loaded,catalog});
void forged;void synchronous;
