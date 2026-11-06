import * as Music from '../../music-document';
import * as Piano from '../../piano-catalog-adapter';
const score:Music.Document={schemaVersion:1,id:'part-a',revision:'original',timeUnit:'quarter',bpm:60,parts:[{id:'melody'}],notes:[{id:'n1',partId:'melody',pitch:{kind:'midi',value:60},span:{kind:'known',start:0,duration:1/3}},{id:'n2',partId:'melody',pitch:{kind:'frequency',hz:660},span:{kind:'unknown'}}]};
Music.assertValid(score);
const entry={id:'mine',pattern:'t',learning:{goal:'Мой разбор'},rhythm:null};
const view=Piano.project(entry),restored=Piano.restore(view);
const goal:string=restored.learning.goal;
const assignment:Piano.PianoAssignment={noteId:score.notes[0].id,hand:'right',finger:5};
// @ts-expect-error Piano has no finger 0.
const invalidFinger:Piano.PianoAssignment={noteId:'n1',hand:'left',finger:0};
// @ts-expect-error Unknown timing cannot be consumed as a duration.
const unknownDuration:number=score.notes[1].span.duration;
// @ts-expect-error Pitch and rendering are not mutable through the read-only projection.
view.music.notes[0].pitch={kind:'midi',value:62};
// @ts-expect-error A stored catalog cannot contain executable metadata.
Piano.project({id:'bad',pattern:'t',callback:()=>true});
const legacy=Piano.roundTripCatalog({version:7 as const,themes:[{id:'theme'}],lessons:[entry]});
const retained:string=legacy.lessons[0].learning.goal;
void [goal,assignment,invalidFinger,unknownDuration,retained];
