import * as Copy from './piano-legacy-catalog-copy';
declare const indexedDB:IDBFactory,subtle:SubtleCrypto,storage:Storage;
const copies=Copy.create({indexedDB,subtle});
async function run(){const change=await copies.prepareFrom(storage),receipt=await copies.commit(change),saved=await copies.read(receipt.snapshot.id);if(saved){const raw:string|null=saved.raw;void raw;}const text:string=await copies.exportRecovery();void text;
 // @ts-expect-error Metadata is not a prepared opaque change.
 await copies.commit(receipt.snapshot);
 // @ts-expect-error Snapshot is readonly.
 if(saved)saved.raw='rewritten';
 // @ts-expect-error A raw catalog string is not a source storage adapter.
 await copies.prepareFrom('{}');
}
void run;
