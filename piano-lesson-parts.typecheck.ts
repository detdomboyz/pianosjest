import * as Parts from './piano-lesson-parts';
const catalog:Parts.Catalog={version:7,themes:[{id:'theme',name:'Theme',order:1}],lessons:[{id:'lesson',themeId:'theme',pattern:'t',contentKind:'exercise'}]};
const bundle=Parts.build(catalog,{release:'23.5.39',webManifestSha256:'0'.repeat(64),themeIds:['theme']});
const manifest:Parts.Manifest=Parts.readManifest(bundle.manifestBytes,bundle.manifestSha256);
const result:Parts.Catalog=Parts.assemble(manifest,bundle.files);
const topic:Parts.Topic=Parts.readPart(manifest,manifest.parts[0].key,new Uint8Array());
void [result,topic,Parts.write(bundle,'tmp/typecheck-only')];
// @ts-expect-error The training contract does not accept a guitar manifest.
const guitar:Parts.Manifest={...manifest,instrument:'guitar'};
// @ts-expect-error Catalog v8 needs an explicit future contract.
Parts.build({...catalog,version:8},{release:'23.5.39',webManifestSha256:'0'.repeat(64),themeIds:['theme']});
// @ts-expect-error Package bytes are binary, not a URL or unchecked JSON string.
Parts.readManifest('{}',bundle.manifestSha256);
void guitar;
