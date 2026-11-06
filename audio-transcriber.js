(function (root) {
  'use strict';

  const MIN_MIDI = 36;
  const MAX_MIDI = 96;

  function midiFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function makeHann(size) {
    const window = new Float64Array(size);
    for (let index = 0; index < size; index++) window[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
    return window;
  }

  function fft(real, imaginary) {
    const length = real.length;
    for (let index = 1, reversed = 0; index < length; index++) {
      let bit = length >> 1;
      for (; reversed & bit; bit >>= 1) reversed ^= bit;
      reversed ^= bit;
      if (index < reversed) {
        const realValue = real[index];
        real[index] = real[reversed];
        real[reversed] = realValue;
        const imaginaryValue = imaginary[index];
        imaginary[index] = imaginary[reversed];
        imaginary[reversed] = imaginaryValue;
      }
    }
    for (let block = 2; block <= length; block <<= 1) {
      const angle = -2 * Math.PI / block;
      const baseReal = Math.cos(angle);
      const baseImaginary = Math.sin(angle);
      for (let offset = 0; offset < length; offset += block) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let index = 0; index < block / 2; index++) {
          const even = offset + index;
          const odd = even + block / 2;
          const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          real[odd] = real[even] - oddReal;
          imaginary[odd] = imaginary[even] - oddImaginary;
          real[even] += oddReal;
          imaginary[even] += oddImaginary;
          const nextReal = twiddleReal * baseReal - twiddleImaginary * baseImaginary;
          twiddleImaginary = twiddleReal * baseImaginary + twiddleImaginary * baseReal;
          twiddleReal = nextReal;
        }
      }
    }
  }

  function magnitudeNear(magnitudes, bin) {
    const center = Math.round(bin);
    let value = 0;
    for (let delta = -1; delta <= 1; delta++) {
      const index = center + delta;
      if (index > 0 && index < magnitudes.length) value = Math.max(value, magnitudes[index]);
    }
    return value;
  }

  function spectralCandidates(real, imaginary, sampleRate, options) {
    fft(real, imaginary);
    const half = real.length / 2;
    const magnitudes = new Float64Array(half);
    for (let index = 1; index < half; index++) magnitudes[index] = Math.hypot(real[index], imaginary[index]);
    const scores = new Float64Array(MAX_MIDI - MIN_MIDI + 1);
    const fundamentals = new Float64Array(scores.length);
    let maximum = 0;
    for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
      const frequency = midiFrequency(midi);
      const bin = frequency * real.length / sampleRate;
      const fundamental = magnitudeNear(magnitudes, bin);
      let score = fundamental;
      if (bin * 2 < half) score += magnitudeNear(magnitudes, bin * 2) * 0.32;
      if (bin * 3 < half) score += magnitudeNear(magnitudes, bin * 3) * 0.16;
      const index = midi - MIN_MIDI;
      fundamentals[index] = fundamental;
      scores[index] = score;
      maximum = Math.max(maximum, score);
    }
    if (!maximum) return { candidates: [], scores };
    const sensitivity = clamp(Number(options.sensitivity) || 0.62, 0.2, 0.95);
    const threshold = maximum * (0.66 - sensitivity * 0.43);
    const ranked = [];
    for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
      const index = midi - MIN_MIDI;
      const score = scores[index];
      const left = index ? scores[index - 1] : 0;
      const right = index + 1 < scores.length ? scores[index + 1] : 0;
      if (score < threshold || score < left || score <= right) continue;
      const fundamental = fundamentals[index];
      if (fundamental < maximum * 0.035) continue;
      ranked.push({ midi, score, fundamental });
    }
    ranked.sort((a, b) => b.score - a.score);
    const selected = [];
    const maxPolyphony = clamp(Math.round(Number(options.maxPolyphony) || 4), 1, 6);
    for (const candidate of ranked) {
      if (selected.length >= maxPolyphony) break;
      if (selected.some((item) => Math.abs(item.midi - candidate.midi) <= 1)) continue;
      const octaveBase = selected.find((item) => item.midi === candidate.midi - 12);
      if (octaveBase && candidate.fundamental < octaveBase.fundamental * 0.34) continue;
      selected.push(candidate);
    }
    selected.sort((a, b) => a.midi - b.midi);
    return { candidates: selected, scores };
  }

  function readMixedSample(channels, sourcePosition) {
    const left = Math.floor(sourcePosition);
    const fraction = sourcePosition - left;
    if (left < 0 || left >= channels[0].length) return 0;
    let value = 0;
    const right = Math.min(channels[0].length - 1, left + 1);
    for (const channel of channels) value += channel[left] + (channel[right] - channel[left]) * fraction;
    return value / channels.length;
  }

  function closeTrackedNote(events, state, midi, endMs, minimumNoteMs) {
    if (!state.active) return;
    const durationMs = Math.max(1, endMs - state.startMs);
    if (durationMs >= minimumNoteMs) {
      events.push({ note: midi, startMs: Math.round(state.startMs), endMs: Math.round(endMs), durationMs: Math.round(durationMs), velocity: Math.round(clamp(state.peakScore * 127, 1, 127)) });
    }
    state.active = false;
    state.presentFrames = 0;
    state.missingFrames = 0;
    state.peakScore = 0;
  }

  async function decodeAudio(file, progress) {
    const AudioContextClass = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Браузер не поддерживает декодирование звука через Web Audio.');
    progress({ phase: 'decode', percent: 2, message: 'Читаю звуковую дорожку…' });
    const context = new AudioContextClass();
    try {
      const bytes = await file.arrayBuffer();
      progress({ phase: 'decode', percent: 7, message: 'Декодирую MP3/MP4…' });
      return await context.decodeAudioData(bytes.slice(0));
    } catch (error) {
      const extension = String(file && file.name || '').split('.').pop().toUpperCase();
      throw new Error(`Не удалось открыть звуковую дорожку ${extension || 'файла'}. Для MP4 нужен обычный аудиокодек AAC/MP3; защищённые и редкие кодеки браузер не декодирует. ${error && error.message ? error.message : ''}`.trim());
    } finally {
      try { await context.close(); } catch (error) { }
    }
  }

  async function transcribe(file, rawOptions, onProgress) {
    const options = rawOptions || {};
    const progress = typeof onProgress === 'function' ? onProgress : function () { };
    const audio = await decodeAudio(file, progress);
    const maximumSeconds = clamp(Number(options.maximumSeconds) || 900, 10, 1800);
    const analyzedSeconds = Math.min(audio.duration, maximumSeconds);
    const analysisRate = 11025;
    const fftSize = 2048;
    const hopSize = 512;
    const ratio = audio.sampleRate / analysisRate;
    const channels = [];
    for (let channel = 0; channel < audio.numberOfChannels; channel++) channels.push(audio.getChannelData(channel));
    const totalAnalysisSamples = Math.floor(analyzedSeconds * analysisRate);
    const totalFrames = Math.max(1, Math.floor((totalAnalysisSamples - fftSize) / hopSize) + 1);
    const hann = makeHann(fftSize);
    const real = new Float64Array(fftSize);
    const imaginary = new Float64Array(fftSize);
    const tracks = new Map();
    const events = [];
    const stableFrames = 2;
    const releaseFrames = 2;
    const minimumNoteMs = clamp(Number(options.minimumNoteMs) || 110, 60, 700);
    const hopMs = hopSize / analysisRate * 1000;

    progress({ phase: 'analyze', percent: 10, message: 'Ищу высоту звуков и моменты нажатий…' });
    for (let frame = 0; frame < totalFrames; frame++) {
      let mean = 0;
      const analysisOffset = frame * hopSize;
      for (let index = 0; index < fftSize; index++) {
        const sample = readMixedSample(channels, (analysisOffset + index) * ratio);
        real[index] = sample;
        imaginary[index] = 0;
        mean += sample;
      }
      mean /= fftSize;
      let energy = 0;
      for (let index = 0; index < fftSize; index++) {
        const centered = real[index] - mean;
        energy += centered * centered;
        real[index] = centered * hann[index];
      }
      const rms = Math.sqrt(energy / fftSize);
      const frameMs = analysisOffset / analysisRate * 1000;
      const result = rms > 0.0012 ? spectralCandidates(real, imaginary, analysisRate, options) : { candidates: [], scores: new Float64Array(MAX_MIDI - MIN_MIDI + 1) };
      const candidateByMidi = new Map(result.candidates.map((candidate) => [candidate.midi, candidate]));

      for (let midi = MIN_MIDI; midi <= MAX_MIDI; midi++) {
        let state = tracks.get(midi);
        if (!state) {
          state = { active: false, presentFrames: 0, missingFrames: 0, startMs: 0, peakScore: 0, previousScore: 0, ageFrames: 0 };
          tracks.set(midi, state);
        }
        const candidate = candidateByMidi.get(midi);
        const score = candidate ? candidate.score : 0;
        if (candidate) {
          state.presentFrames++;
          state.missingFrames = 0;
          if (!state.active && state.presentFrames >= stableFrames) {
            state.active = true;
            state.startMs = Math.max(0, frameMs - (stableFrames - 1) * hopMs);
            state.peakScore = score;
            state.ageFrames = 0;
          } else if (state.active) {
            state.ageFrames++;
            const renewedAttack = state.ageFrames >= 4 && state.previousScore > 0 && score > state.previousScore * 2.15 && state.previousScore < state.peakScore * 0.48;
            if (renewedAttack) {
              closeTrackedNote(events, state, midi, frameMs, minimumNoteMs);
              state.active = true;
              state.startMs = frameMs;
              state.peakScore = score;
              state.ageFrames = 0;
            } else {
              state.peakScore = Math.max(state.peakScore, score);
            }
          }
        } else {
          state.presentFrames = 0;
          if (state.active) {
            state.missingFrames++;
            state.ageFrames++;
            if (state.missingFrames >= releaseFrames) closeTrackedNote(events, state, midi, frameMs - (releaseFrames - 1) * hopMs, minimumNoteMs);
          }
        }
        state.previousScore = score;
      }

      if (frame % 18 === 0 || frame + 1 === totalFrames) {
        const percent = 10 + Math.round((frame + 1) / totalFrames * 87);
        progress({ phase: 'analyze', percent, message: `Распознаю звук: ${Math.min(100, Math.round((frame + 1) / totalFrames * 100))}%` });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const endingMs = analyzedSeconds * 1000;
    for (const [midi, state] of tracks) closeTrackedNote(events, state, midi, endingMs, minimumNoteMs);
    events.sort((a, b) => a.startMs - b.startMs || a.note - b.note);
    if (!events.length) throw new Error('Не удалось уверенно распознать ноты. Попробуй увеличить чувствительность или взять запись, где пианино звучит без голоса и ударных.');
    progress({ phase: 'done', percent: 100, message: `Готово: найдено ${events.length} нот.` });
    return {
      notes: events,
      durationMs: Math.round(audio.duration * 1000),
      analyzedDurationMs: Math.round(analyzedSeconds * 1000),
      truncated: audio.duration > analyzedSeconds,
      sampleRate: audio.sampleRate,
      frames: totalFrames
    };
  }

  const api = { transcribe, fft, spectralCandidates, midiFrequency };
  root.PianoAudioTranscriber = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
