'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const Catalog=require('../catalog-sections.js');
const {loadApp}=require('./helpers/load-app.cjs'),{loadGuitarCourse}=require('../tools/curriculum-inventory.cjs'),{loadGuitarApp}=require('./helpers/load-guitar-app.cjs');
const guitarRoot=process.env.GUITAR_TEST_ROOT||path.resolve(__dirname,'../../guitarjest');
test('every item belongs to one functional section without changing music or IDs',()=>{
  const piano=loadApp(),guitar=loadGuitarCourse();
  for(const [instrument,items,groups] of [['piano',piano.lessons,piano.themes],['guitar',guitar.lessons,guitar.topics]]){
    const original=JSON.stringify(items),a=Catalog.available(instrument,'learning',items,groups),b=Catalog.available(instrument,'pieces',items,groups);
    assert.equal(a.length+b.length,items.length);assert.equal(new Set([...a,...b].map(l=>l.id)).size,items.length);assert.equal(a.some(l=>b.includes(l)),false);assert.equal(JSON.stringify(items),original);
  }
});
test('named works are separate while familiar melodies used to teach a skill stay in the course',()=>{
  const piano=loadApp(),kind=id=>Catalog.sectionOf('piano',piano.lessons.find(l=>l.id===id),piano.themes);
  assert.equal(kind('course09-01'),'learning');assert.equal(kind('course09-03'),'learning');assert.equal(kind('fav-desperado-part-01'),'pieces');assert.equal(kind('chopin-midi-prep-right'),'pieces');assert.equal(kind('mfrag01'),'learning');
  const twinkle=Catalog.works('piano',piano.lessons,piano.themes).find(w=>w.id==='builtin-twinkle');assert.deepEqual(Array.from(twinkle.lessons,l=>l.id),['mel201','mel202','mel203']);
  assert.equal(Catalog.workKey('piano',{...twinkle.lessons[0],themeId:'my-new-work'}),'my-new-work');
});
test('user classification overrides defaults and imports; unknown exercises are retained',()=>{
  const group={id:'custom',contentKind:'piece'},lesson={id:'custom-exercise',themeId:'custom',pattern:'t'};
  assert.equal(Catalog.sectionOf('piano',lesson,[group]),'pieces');lesson.contentKind='exercise';assert.equal(Catalog.sectionOf('piano',lesson,[group]),'learning');
  assert.equal(Catalog.kind('piano',{id:'import',rhythm:{source:'midi'}},{}),'piece');assert.equal(Catalog.kind('piano',{id:'unknown'},{}),'exercise');
});
test('an empty section remains empty instead of returning an item from the other function',()=>{
  const lessons=[{id:'one',themeId:'skills'}],groups=[{id:'skills'},{id:'my-work',name:'My work',contentKind:'piece'}];
  assert.equal(Catalog.resolve('piano','pieces',lessons,groups,'one'),null);assert.equal(Catalog.works('piano',lessons,groups)[0].lessons.length,0);
});
test('piano section switching restores independent positions, stops the attempt and preserves progress',()=>{
  const saved=new Map(),storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},app=loadApp({events:true,storage});
  app.selectLesson('course02-03');app.state.learningProgress.untouched={cleanTakes:2};app.state.active.add(60);app.state.pcPressedByCode.KeyT='t';
  app.setContentSection('pieces');assert.equal(app.state.active.size,0);assert.equal(app.state.started,false);assert.equal(app.state.attemptMode,'practice');
  app.selectLesson('fav-desperado-part-02');app.setContentSection('learning');assert.equal(app.state.lesson.id,'course02-03');app.setContentSection('pieces');assert.equal(app.state.lesson.id,'fav-desperado-part-02');assert.equal(app.state.learningProgress.untouched.cleanTakes,2);
  const reloaded=loadApp({events:true,storage});reloaded.loadCatalogWorkspace();assert.equal(reloaded.state.contentSection,'pieces');assert.equal(reloaded.state.lesson.id,'fav-desperado-part-02');
});
test('piano catalog, search and next fragment cannot leak the other section or another work',()=>{
  const app=loadApp({events:true});assert.ok(app.filteredCatalog().flatMap(g=>g.lessons).every(l=>!/^fav-|^chopin-midi-/.test(l.id)));
  app.setContentSection('pieces');app.selectLesson('fav-desperado-part-01');const work=Catalog.work('piano',app.state.lesson,app.lessons,app.themes);app.selectLesson(work.lessons.at(-1).id);app.nextLesson();assert.equal(app.state.lesson.id,work.lessons.at(-1).id);
  assert.ok(app.filteredCatalog().flatMap(g=>g.lessons).every(l=>Catalog.sectionOf('piano',l,app.themes)==='pieces'));app.state.lessonFilter='пять пальцев';assert.equal(app.filteredCatalog().length,0);
});
test('explicit classifications survive piano export/load without changing the note sequence',()=>{
  const app=loadApp(),lesson=app.lessons.find(l=>l.id==='mfrag01');lesson.contentKind='piece';const pattern=lesson.pattern;const snapshot=app.catalogSnapshot();assert.equal(app.applyCatalogSnapshot(snapshot),true);const restored=app.lessons.find(l=>l.id===lesson.id);assert.equal(restored.contentKind,'piece');assert.equal(restored.pattern,pattern);
});
test('guitar learning path and repertoire have independent navigation and selected positions',()=>{
  const app=loadGuitarApp(guitarRoot),data=loadGuitarCourse();app.selectLesson('t03-l02',false);assert.ok(app.guidedLessons().every(l=>Catalog.sectionOf('guitar',l,data.topics)==='learning'));
  app.setContentSection('pieces');app.selectLesson('m01-l02',false);const selected=app.state.selectedLessonId;app.setContentSection('learning');assert.equal(app.state.selectedLessonId,'t03-l02');app.setContentSection('pieces');assert.equal(app.state.selectedLessonId,selected);
  const pieces=data.topics.find(t=>t.id==='mel-01').lessons;app.selectLesson(pieces.at(-1).id,false);app.nextLesson();assert.equal(app.state.selectedLessonId,pieces.at(-1).id);
  assert.match(app.piecePracticeHtml(pieces[0]),/Работа над произведением/);assert.doesNotMatch(app.renderSidebarListOnly(),/Первые лады/);
});
