import {prepare,materialize,compareRelease,type Plan,type Pin,type PackageInput} from './piano-lesson-package-update';
import type {Catalog} from './piano-lesson-parts';
declare const catalog:Catalog,previous:PackageInput,incoming:PackageInput,active:Pin;
const proposal:Plan=prepare({catalog,previous,incoming,active});
const next=materialize(proposal,catalog);const saved:Catalog=next.catalog;const order:-1|0|1=compareRelease('23.5.39','23.5.40');
void saved;void order;
// @ts-expect-error Progress remains a separate store, outside this input contract.
prepare({catalog,previous,incoming,active,progress:{}});
// @ts-expect-error A serialized summary is not an opaque live proposal.
materialize({version:1,status:'ready'},catalog);
// @ts-expect-error The plan is immutable to consumers.
proposal.changedLessonIds.push('private');
// @ts-expect-error A pin requires the trusted package manifest digest.
const missingPin:Pin={release:'23.5.40',webManifestSha256:'a'};
void missingPin;
