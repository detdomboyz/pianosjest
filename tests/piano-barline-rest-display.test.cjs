'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');

const app = loadApp();
const lesson = id => app.lessons.find(record => record.id === id);
const leftWaltz = 'detail-p-left-waltz-approach-chord-01';
const pairedWaltz = 'detail-p-paired-waltz-shared-cadence-01';

function score(record, bpm = record.rhythm.practiceBpm) {
  app.state.lesson = record;
  app.state.mode = 'score';
  app.state.attemptMode = 'practice';
  app.state.stepIndex = 0;
  app.state.playbackBpm = bpm;
  return app.scoreViewHtml();
}

function measures(html) {
  return new Map(Array.from(
    html.matchAll(/<section class="rhythm-measure"[^>]*><div class="measure-head"><span>Такт (\d+)<\/span>([\s\S]*?)<\/section>/g),
    ([, number, body]) => [Number(number), body]
  ));
}

function restBoxes(html) {
  return Array.from(
    html.matchAll(/<span class="rhythm-rest" style="--lane:(\d+);left:([\d.]+)%;width:([\d.]+)%" title="([^"]+)">([^<]+)<\/span>/g),
    ([, lane, left, width, tooltip, label]) => ({ lane: Number(lane), left: Number(left), width: Number(width), tooltip, label })
  );
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

for (const id of [leftWaltz, pairedWaltz]) {
  test(`${id}: the quarter-beat rest ends at the previous barline`, () => {
    const record = lesson(id);
    const before = JSON.stringify(record.rhythm);
    const bars = measures(score(record));
    const rests = restBoxes(bars.get(1));
    assert.equal(rests.length, 1);
    closeTo(rests[0].left, 100 * 2.75 / 3);
    closeTo(rests[0].width, 100 * 0.25 / 3);
    closeTo(rests[0].left + rests[0].width, 100);
    assert.equal(rests[0].label, '313 мс');
    assert.match(bars.get(1), /data-score-step="3" style="--lane:0;left:83\.333[^%]*%/);
    assert.match(bars.get(2), /data-score-step="4" style="--lane:0;left:0%;width:100%/);
    assert.match(bars.get(2), /пауза до: 313 мс/);
    assert.equal(restBoxes(bars.get(2)).length, 0);
    assert.equal(JSON.stringify(record.rhythm), before);

    const at60 = measures(score(record, 60));
    assert.equal(restBoxes(at60.get(1))[0].label, '250 мс');
    closeTo(restBoxes(at60.get(1))[0].left, rests[0].left);
    assert.match(at60.get(2), /пауза до: 250 мс/);
  });
}

function twoNoteScore(first, second) {
  const record = lesson(leftWaltz);
  return {
    ...record,
    steps: record.steps.slice(0, 2),
    rhythm: {
      version: 1, source: 'manual', bpm: 60, practiceBpm: 60,
      timeSignature: { numerator: 3, denominator: 4 },
      steps: [first, second]
    }
  };
}

test('a written rest crossing two barlines fills the empty bar and labels the visible portions', () => {
  const record = twoNoteScore(
    { startBeat: 0, measure: 4, beatInMeasure: 0, durationBeats: 2.5, restBeforeBeats: 0 },
    { startBeat: 6.5, measure: 6, beatInMeasure: 0.5, durationBeats: 1, restBeforeBeats: 4 }
  );
  const bars = measures(score(record));
  assert.deepEqual([...bars.keys()], [4, 5, 6]);
  for (const [number, left, width, milliseconds] of [[4, 250 / 3, 50 / 3, 500], [5, 0, 100, 3000], [6, 0, 50 / 3, 500]]) {
    const rests = restBoxes(bars.get(number));
    assert.equal(rests.length, 1);
    closeTo(rests[0].left, left);
    closeTo(rests[0].width, width);
    assert.equal(rests[0].label, `${milliseconds} мс`);
    assert.match(rests[0].tooltip, /4000 мс/);
  }
  assert.doesNotMatch(bars.get(5), /data-score-(step|continuation)=/);
  assert.match(bars.get(6), /data-score-step="1"[^>]*пауза до: 4000 мс/);
});

test('existing in-bar rests retain their position and the open note starts on its beat', () => {
  const bars = measures(score(lesson('detail-p-release-02'), 40));
  const rests = restBoxes(bars.get(1));
  assert.equal(rests.length, 3);
  closeTo(rests[0].left, 16.25);
  closeTo(rests[0].width, 8.75);
  assert.equal(rests[0].tooltip, 'Пауза перед этой нотой: 525 мс');
  assert.match(bars.get(1), /data-score-step="1" style="--lane:0;left:25%;width:16\.25%/);
});

test('a held note crossing a barline keeps its continuation without a rest marker', () => {
  const record = twoNoteScore(
    { startBeat: 0, measure: 4, beatInMeasure: 0, durationBeats: 4, restBeforeBeats: 0 },
    { startBeat: 4, measure: 5, beatInMeasure: 1, durationBeats: 1, restBeforeBeats: 0 }
  );
  const html = score(record);
  assert.equal(restBoxes(html).length, 0);
  assert.match(measures(html).get(5), /data-score-continuation="0"/);
  assert.equal(Array.from(html.matchAll(/data-score-step="0"/g)).length, 1);
});

test('a pickup at the first displayed bar does not invent earlier measures, and memory hides the timeline', () => {
  const record = twoNoteScore(
    { startBeat: 0, measure: 21, beatInMeasure: 0, durationBeats: 1, restBeforeBeats: 1 },
    { startBeat: 1, measure: 21, beatInMeasure: 1, durationBeats: 1, restBeforeBeats: 0 }
  );
  assert.deepEqual([...measures(score(record)).keys()], [21]);
  app.state.attemptMode = 'memory';
  try {
    assert.doesNotMatch(app.scoreViewHtml(), /rhythm-rest|data-score-step/);
  } finally {
    app.state.attemptMode = 'practice';
  }
});
