'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');

// Run the actual shipped browser code without boot/network/storage writes.
// This is integration coverage of lesson data and adapters, not a browser test.
function loadApp(options={}) {
  const appRoot=path.resolve(options.appRoot||ROOT);
  const context = vm.createContext({
    console, URLSearchParams, TextEncoder, setTimeout:options.timers?.setTimeout||setTimeout, clearTimeout:options.timers?.clearTimeout||clearTimeout, setInterval:options.timers?.setInterval||setInterval, clearInterval:options.timers?.clearInterval||clearInterval,
    performance:{now:()=>options.clock?.now??Date.now()},
    location: { search: '', protocol:'http:' }, navigator: {locks:options.locks}, fetch:options.fetch, EventSource:options.EventSource,
    document: { getElementById: id => options.elements?.[id]||{}, querySelector: selector => options.selectors?.[selector]||null, addEventListener() {} },
    localStorage: options.storage||{ getItem: () => null, setItem() { throw new Error('Tests must not write user storage'); } },
    window: { addEventListener:options.onWindowEvent||(()=>{}), PBT_RUNTIME:options.web?{mode:'web'}:undefined, EventSource:options.EventSource, AudioContext:options.AudioContext }
  });
  for (const filename of ['chopin-theme.js', 'fingering.js', 'beginner-fingering.js','practice-assessment.js','music-document.js','piano-catalog-adapter.js','piano-progress-store.js','piano-preparation.js','piano-preparation-store.js','piano-preparation-fragment.js','piano-preparation-capture.js','piano-preparation-transfer.js','piano-preparation-import.js','curriculum.js','curriculum-plan.js','catalog-sections.js','lesson-review-baseline.js','lesson-quality.js','lesson-development.js','piano-lesson-development.js','piano-learning-ui.js','catalog-transfer.js']) {
    if (fs.existsSync(path.join(appRoot, filename))) {
      vm.runInContext(fs.readFileSync(path.join(appRoot, filename), 'utf8'), context, { filename });
    }
  }
  const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
  let source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  if(options.unreviewed)source=source.replace('  installReviewedLessons();','  /* Frozen pre-review catalogue for migration regression tests. */');
  const exportCode = `globalThis.testApp = {
    lessons, themes, BEGINNER_CURRICULUM, KEY_MAP, state, makeLesson, parsePattern, installReviewedLessons, normalizeLessonRhythm, normalizeLessonGuide, lessonSpacesBefore,
    buildFingeringPlan, ensureFingeringPlan, fingeringSignature, serializeFingeringPlan,
    normalizeStoredFingeringPlan, fingeringSelfCheck, auditBeginnerCurriculum,
    lessonHandMode, fingerLayoutReachCost, fingerHint, stepMidiList, phraseGap,
    catalogSnapshot, applyCatalogSnapshot, challengeEligible, completeLesson, handleNoteOn, handleNoteOff,
    resetLessonState, practiceRange, setPracticeRange, practiceFragmentHtml, checkCurrentRhythm, loadLearningProgress, learningContractHtml, filteredCatalog, nextLesson,previewSoundDurationMs,openLessonEditor,
    setContentSection,selectLesson,sectionLessons,loadCatalogWorkspace,restoreCatalogSelection,catalogNavigationHtml,piecePracticeHtml,rememberCatalogSelection,
    loadUiPreferences,saveUiPreferences,learningMaterialHtml,setLearningMaterialMode,
    loadCatalog,saveCatalog,connectMidiBridgeEvents,launchMidiKeyboardProgram,selectMidiInput,refreshMidiDevices,
    catalogSaveSnapshot,retryCatalogSave,catalogSaveNoticeHtml,persistBrowserCatalog,
    catalogExportText,importCatalogText,legacyProgressStore,preparationCapture,fragmentCapture,setPreparationScope,activePreparationFragment,visibleStepCount,preparationScopeHtml,preparationLogHtml,preparePreparationExport,canExposePreparationExport,inspectPreparationImport,preparationInspectionHtml,preparationInspectionText,preparationImportStore,comparePreparationImport,applyPreparationImport,restorePreparationImportSource,canApplyPreparationImport,preparationImportResultText,
    lessonTitle,sidebarHtml,setAttemptMode,setBlindMode,startMemoryCheck,currentNoteHtml,octaveChipsHtml,startPlayback,stopPlayback,pausePlayback,playbackTick,playbackDurations,playPreviewMidi,renderPlaybackOnly,scoreViewHtml,changePracticeBpm,attemptEndingWindow,maybeCompleteEnding,lessonStatusText,
    setTestLesson:lesson=>{state.lesson=lesson;resetLessonState();}
  };`;
  // The explicit marker makes unexpected startup changes fail loudly.
  if (!source.includes('  boot();')) throw new Error('App boot marker not found');
  const stubs=options.events?`render=()=>{};renderKeyboardOnly=()=>{};renderMessageAndStats=()=>{};saveScoreScroll=()=>{};saveSidebarScroll=()=>{};playSound=()=>{};stopSound=()=>{};${options.playback?(options.AudioContext?'':'ensureAudio=()=>{};playPreviewMidi=()=>{};')+'renderScoreViewOnly=()=>{};':'stopPlayback=()=>{};'}`:'';
  vm.runInContext(source.replace('  boot();',stubs+exportCode), context, { filename: 'index.html' });
  return context.testApp;
}

module.exports = { loadApp };
