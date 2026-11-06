#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const KEY_MAP = {
  '1':36,'2':38,'3':40,'4':41,'5':43,'6':45,'7':47,'8':48,'9':50,'0':52,
  'q':53,'w':55,'e':57,'r':59,'t':60,'y':62,'u':64,'i':65,'o':67,'p':69,
  'a':71,'s':72,'d':74,'f':76,'g':77,'h':79,'j':81,'k':83,'l':84,
  'z':86,'x':88,'c':89,'v':91,'b':93,'n':95,'m':96,
  '!':37,'@':39,'$':42,'%':44,'^':46,'*':49,'(':51,
  'Q':54,'W':56,'E':58,'T':61,'Y':63,'I':66,'O':68,'P':70,
  'S':73,'D':75,'G':78,'H':80,'J':82,'L':85,'Z':87,'C':90,'V':92,'B':94
};
const MIDI_TO_KEY = new Map(Object.entries(KEY_MAP).map(([key, midi]) => [midi, key]));

function fail(message) {
  process.stderr.write(`Ошибка: ${message}\n`);
  process.exit(1);
}

function readVar(buffer, cursor, end) {
  let value = 0;
  for (let guard = 0; guard < 4 && cursor.pos < end; guard++) {
    const byte = buffer[cursor.pos++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  return value;
}

function parseMidi(buffer) {
  if (buffer.length < 14 || buffer.toString('ascii', 0, 4) !== 'MThd') fail('файл не содержит заголовок MThd.');
  const headerLength = buffer.readUInt32BE(4);
  const format = buffer.readUInt16BE(8);
  const trackCount = buffer.readUInt16BE(10);
  const division = buffer.readUInt16BE(12);
  if (division & 0x8000) fail('SMPTE MIDI пока не поддерживается генератором темы.');
  let pos = 8 + headerLength;
  const notes = [];
  const tempos = [];
  const signatures = [];
  const active = new Map();
  let finalTick = 0;

  for (let track = 0; track < trackCount && pos + 8 <= buffer.length; track++) {
    const chunk = buffer.toString('ascii', pos, pos + 4);
    const length = buffer.readUInt32BE(pos + 4);
    pos += 8;
    const end = Math.min(buffer.length, pos + length);
    if (chunk !== 'MTrk') {
      pos = end;
      continue;
    }
    let tick = 0;
    let running = 0;
    while (pos < end) {
      const cursor = { pos };
      tick += readVar(buffer, cursor, end);
      pos = cursor.pos;
      finalTick = Math.max(finalTick, tick);
      if (pos >= end) break;
      let status = buffer[pos];
      if (status < 0x80) {
        if (!running) fail('некорректный running status.');
        status = running;
      } else {
        pos++;
        running = status < 0xf0 ? status : 0;
      }

      if (status === 0xff) {
        if (pos >= end) break;
        const type = buffer[pos++];
        const metaCursor = { pos };
        const metaLength = readVar(buffer, metaCursor, end);
        pos = metaCursor.pos;
        if (type === 0x51 && metaLength === 3 && pos + 3 <= end) {
          tempos.push({ tick, usPerQuarter: buffer.readUIntBE(pos, 3) });
        } else if (type === 0x58 && metaLength >= 2 && pos + 2 <= end) {
          signatures.push({ tick, numerator: buffer[pos], denominator: 2 ** buffer[pos + 1] });
        }
        pos = Math.min(end, pos + metaLength);
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const sysexCursor = { pos };
        const sysexLength = readVar(buffer, sysexCursor, end);
        pos = Math.min(end, sysexCursor.pos + sysexLength);
        continue;
      }

      const command = status & 0xf0;
      const channel = status & 0x0f;
      const dataLength = command === 0xc0 || command === 0xd0 ? 1 : 2;
      if (pos + dataLength > end) break;
      const data1 = buffer[pos++];
      const data2 = dataLength === 2 ? buffer[pos++] : 0;
      const key = `${track}:${channel}:${data1}`;
      const isOn = command === 0x90 && data2 > 0;
      const isOff = command === 0x80 || (command === 0x90 && data2 === 0);
      if (isOn) {
        const queue = active.get(key) || [];
        queue.push({ note: data1, velocity: data2, startTick: tick, track, channel });
        active.set(key, queue);
      } else if (isOff) {
        const queue = active.get(key);
        if (queue && queue.length) {
          const event = queue.shift();
          event.endTick = Math.max(tick, event.startTick + 1);
          notes.push(event);
          if (!queue.length) active.delete(key);
        }
      }
    }
    pos = end;
  }

  for (const queue of active.values()) {
    for (const event of queue) {
      event.endTick = Math.max(finalTick, event.startTick + Math.max(1, Math.round(division / 4)));
      notes.push(event);
    }
  }
  if (!notes.length) fail('в MIDI нет нот.');
  notes.sort((a, b) => a.startTick - b.startTick || a.note - b.note || a.track - b.track);
  tempos.sort((a, b) => a.tick - b.tick);
  signatures.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick !== 0) tempos.unshift({ tick: 0, usPerQuarter: 500000 });
  if (!signatures.length || signatures[0].tick !== 0) signatures.unshift({ tick: 0, numerator: 4, denominator: 4 });

  const tempoSegments = [];
  let lastTick = 0;
  let lastMs = 0;
  let lastTempo = tempos[0].usPerQuarter;
  tempoSegments.push({ tick: 0, ms: 0, usPerQuarter: lastTempo });
  for (const tempo of tempos) {
    if (tempo.tick < lastTick) continue;
    lastMs += (tempo.tick - lastTick) * lastTempo / division / 1000;
    lastTick = tempo.tick;
    lastTempo = tempo.usPerQuarter;
    if (tempoSegments[tempoSegments.length - 1].tick === tempo.tick) tempoSegments[tempoSegments.length - 1] = { tick: tempo.tick, ms: lastMs, usPerQuarter: lastTempo };
    else tempoSegments.push({ tick: tempo.tick, ms: lastMs, usPerQuarter: lastTempo });
  }
  const tickToMs = (tick) => {
    let segment = tempoSegments[0];
    for (let i = 1; i < tempoSegments.length && tempoSegments[i].tick <= tick; i++) segment = tempoSegments[i];
    return segment.ms + (tick - segment.tick) * segment.usPerQuarter / division / 1000;
  };
  for (const note of notes) {
    note.startMs = tickToMs(note.startTick);
    note.endMs = tickToMs(note.endTick);
  }
  return { format, trackCount, division, notes, tempos, signatures, tempoSegments };
}

function fitMidi(midi) {
  let fitted = midi;
  while (fitted < 36) fitted += 12;
  while (fitted > 96) fitted -= 12;
  return fitted;
}

function roundBeat(value) {
  return Math.round(value * 96) / 96;
}

function groupNotes(parsed, sourceNotes, chordWindowMs = 34) {
  const groups = [];
  for (const event of sourceNotes) {
    const midi = fitMidi(event.note);
    const key = MIDI_TO_KEY.get(midi);
    if (!key) continue;
    let group = groups[groups.length - 1];
    if (!group || event.startMs - group.startMs > chordWindowMs) {
      group = { startMs: event.startMs, startTick: event.startTick, events: [] };
      groups.push(group);
    }
    if (!group.events.some((item) => item.midi === midi)) group.events.push({ ...event, midi, key });
  }
  for (const group of groups) {
    group.events.sort((a, b) => a.midi - b.midi);
    group.startTick = Math.min(...group.events.map((event) => event.startTick));
    group.endTick = Math.max(...group.events.map((event) => event.endTick));
  }
  return groups;
}

function rhythmForGroups(parsed, groups) {
  const firstTick = groups.length ? groups[0].startTick : 0;
  const signature = parsed.signatures[0] || { numerator: 4, denominator: 4 };
  const beatsPerBar = signature.numerator * 4 / signature.denominator;
  const bpm = Math.round(60000000 / (parsed.tempos[0] || { usPerQuarter: 500000 }).usPerQuarter);
  const steps = groups.map((group, index) => {
    const absoluteBeat = group.startTick / parsed.division;
    const startBeat = (group.startTick - firstTick) / parsed.division;
    const durationBeats = Math.max(1 / 16, (group.endTick - group.startTick) / parsed.division);
    const previousEndBeat = index ? (groups[index - 1].endTick - firstTick) / parsed.division : startBeat;
    return {
      startBeat: roundBeat(startBeat),
      durationBeats: roundBeat(durationBeats),
      restBeforeBeats: roundBeat(Math.max(0, startBeat - previousEndBeat)),
      measure: Math.floor(absoluteBeat / beatsPerBar) + 1,
      beatInMeasure: roundBeat(absoluteBeat % beatsPerBar),
      sourceStartMs: Math.round(group.startMs),
      sourceDurationMs: Math.max(1, Math.round(Math.max(...group.events.map((event) => event.endMs)) - group.startMs))
    };
  });
  return {
    version: 1,
    source: 'midi',
    bpm,
    practiceBpm: bpm > 180 ? Math.round(bpm / 2) : bpm,
    timeSignature: { numerator: signature.numerator, denominator: signature.denominator },
    steps
  };
}

function patternForGroups(groups) {
  const tokens = groups.map((group) => group.events.length > 1 ? `[${group.events.map((event) => event.key).join('')}]` : group.events[0].key);
  const lines = [];
  for (let index = 0; index < tokens.length; index += 18) lines.push(tokens.slice(index, index + 18).join(' '));
  return lines.join('\n');
}

function lessonFromGroups(parsed, id, title, description, groups, exam, maxErrors) {
  const rhythm = rhythmForGroups(parsed, groups);
  return {
    id,
    title,
    description,
    pattern: patternForGroups(groups),
    timeLimit: Math.max(90, Math.ceil((rhythm.steps.at(-1)?.sourceStartMs || 0) / 1000 * 1.7 + 45)),
    maxErrors,
    exam,
    rhythm
  };
}

function takeMeasures(parsed, groups, firstMeasure, lastMeasure) {
  const rhythm = rhythmForGroups(parsed, groups);
  return groups.filter((group, index) => {
    const measure = rhythm.steps[index].measure;
    return measure >= firstMeasure && measure <= lastMeasure;
  });
}

function makeTheme(parsed) {
  const allGroups = groupNotes(parsed, parsed.notes);
  if (!allGroups.length) fail('после переноса в диапазон C2–C7 не осталось нот.');
  const fullRhythm = rhythmForGroups(parsed, allGroups);
  const measures = fullRhythm.steps.map((step) => step.measure);
  const firstMeasure = Math.min(...measures);
  const lastMeasure = Math.max(...measures);
  const span = Math.max(1, lastMeasure - firstMeasure + 1);
  const part = Math.max(4, Math.ceil(span / 3));
  const firstEnd = Math.min(lastMeasure, firstMeasure + part - 1);
  const secondEnd = Math.min(lastMeasure, firstEnd + part);
  const opening = takeMeasures(parsed, allGroups, firstMeasure, Math.min(lastMeasure, firstMeasure + 7));
  const rightEvents = parsed.notes.filter((event) => event.note >= 60);
  const leftEvents = parsed.notes.filter((event) => event.note < 60);
  const rightOpening = takeMeasures(parsed, groupNotes(parsed, rightEvents), firstMeasure, Math.min(lastMeasure, firstMeasure + 7));
  const leftOpening = takeMeasures(parsed, groupNotes(parsed, leftEvents), firstMeasure, Math.min(lastMeasure, firstMeasure + 7));
  const lessons = [];
  if (rightOpening.length) lessons.push(lessonFromGroups(parsed, 'chopin-midi-prep-right', 'Подготовка 1 · правая рука и быстрый рисунок', 'Первые такты из присланного MIDI: отдельно верхний голос. Начни медленно, следи за длительностями и постепенно поднимай BPM.', rightOpening, false, 8));
  if (leftOpening.length) lessons.push(lessonFromGroups(parsed, 'chopin-midi-prep-left', 'Подготовка 2 · левая рука и пульс вальса', 'Первые такты: отдельно нижний голос и сопровождение. Считай три доли каждого такта и не сокращай паузы.', leftOpening, false, 8));
  if (opening.length) lessons.push(lessonFromGroups(parsed, 'chopin-midi-prep-together', 'Подготовка 3 · первые такты двумя руками', 'Соединяем руки на вступительном фрагменте. Проверка ритма остаётся дополнительной и включается галочкой.', opening, false, 10));
  lessons.push(lessonFromGroups(parsed, 'chopin-midi-part-a', `Фрагмент A · такты ${firstMeasure}–${firstEnd}`, 'Первая крупная часть точной MIDI-версии. Отработай сначала только клавиши, затем включи проверку ритма.', takeMeasures(parsed, allGroups, firstMeasure, firstEnd), false, 12));
  if (firstEnd < lastMeasure) lessons.push(lessonFromGroups(parsed, 'chopin-midi-part-b', `Фрагмент B · такты ${firstEnd + 1}–${secondEnd}`, 'Средняя часть точной MIDI-версии с сохранёнными паузами и длительностями.', takeMeasures(parsed, allGroups, firstEnd + 1, secondEnd), false, 12));
  if (secondEnd < lastMeasure) lessons.push(lessonFromGroups(parsed, 'chopin-midi-part-c', `Фрагмент C · такты ${secondEnd + 1}–${lastMeasure}`, 'Финальная часть точной MIDI-версии. Ускоряйся только после чистой игры на медленном BPM.', takeMeasures(parsed, allGroups, secondEnd + 1, lastMeasure), false, 12));
  lessons.push(lessonFromGroups(parsed, 'chopin-midi-final', 'Итоговая мелодия / экзамен', 'Полная версия Valse op. 64 No. 1 «Petit Chien» из присланного MIDI: такты, длительности, паузы, аккорды и исходный темп сохранены.', allGroups, true, 24));
  return {
    version: 1,
    sourceFile: 'Valse op.64-1 _Petit Chien_(1).mid',
    name: 'Chopin — Valse op. 64 No. 1 «Petit Chien» · точный MIDI-разбор',
    sourceSummary: {
      format: parsed.format,
      tracks: parsed.trackCount,
      division: parsed.division,
      notes: parsed.notes.length,
      actions: allGroups.length,
      measures: span,
      bpm: fullRhythm.bpm,
      timeSignature: fullRhythm.timeSignature
    },
    lessons
  };
}

function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) fail('использование: node tools/midi-theme-builder.cjs <input.mid> <output.js>.');
  const parsed = parseMidi(fs.readFileSync(input));
  const theme = makeTheme(parsed);
  const body = `'use strict';\nwindow.PBT_CHOPIN_THEME=${JSON.stringify(theme)};\n`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, body, 'utf8');
  process.stdout.write(JSON.stringify(theme.sourceSummary) + '\n');
}

if (require.main === module) main();
module.exports = { parseMidi, groupNotes, rhythmForGroups, patternForGroups, makeTheme };
