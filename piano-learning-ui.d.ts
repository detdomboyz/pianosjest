export type LearningMaterialMode = 'compact' | 'expanded' | 'hidden';
export const MODES: readonly LearningMaterialMode[];
export function normalizeMode(value: unknown): LearningMaterialMode;
/** Localized Russian action count; malformed counts do not become a misleading zero. */
export function actionCountText(value: unknown): string;
export interface RhythmDurationView {
  /** Named note value only when equivalent; otherwise localized numeric duration. */
  label: string;
  /** Quarter-note units. Rounded numeric displays explicitly include an approximation sign. */
  beatsText: string;
  /** Compact musical symbol for an exact named value; null for numeric/invalid durations. */
  symbol: string | null;
  named: boolean;
  valid: boolean;
}
/** Pure display only: does not quantize notes, change playback or alter assessment. */
export function rhythmDurationView(quarterBeats: unknown): RhythmDurationView;
export interface RhythmDisplayStep {
  durationBeats?: number;
  restBeforeBeats?: number;
  sourceStartMs?: number;
  sourceDurationMs?: number;
}
export interface RhythmTimingView {
  bpm: number | null;
  beatMs: number | null;
  durationMs: number | null;
  restMs: number | null;
}
/** Prefer explicit beat data; source milliseconds are scaled only as a fallback. No musical edits. */
export function rhythmTimingView(step: RhythmDisplayStep | null | undefined, previous: RhythmDisplayStep | null | undefined, sourceBpm: unknown, practiceBpm: unknown): RhythmTimingView;
export function controlsHtml(value: unknown, memory?: boolean): string;
export function materialHtml(options: {
  mode: unknown;
  memory?: boolean;
  preview?: string;
  /** Trusted HTML from the existing lesson presenters, invoked only when expanded. */
  renderBody: () => string;
}): string;
export function unwrapMaterial(html: string): string;
export function preparationHtml(items: readonly { id: string; title: string }[]): string;
export function repeatedNoteHtml(currentMidis: readonly number[], previousMidis: readonly number[]): string;
export function sameGoalHtml(item: { id: string; title: string } | null | undefined): string;
/** Explicit multi-skill checkpoint; this does not certify a new independent goal. */
export function checkpointHtml(role: unknown): string;
export function dottedQuarterHtml(durationBeats: number | undefined, beatDenominator: number | undefined): string;
export function memoryAssistanceText(assisted: boolean): string;
export interface LearningPositionCue { stepIndex: number; text: string; }
/** Explicit editorial cues for this action only; this does not infer or assess hand position. */
export function positionChangeHtml(cues: readonly LearningPositionCue[] | null | undefined, stepIndex: number): string;
/** Four quarter-note beats in 4/4 only; other meters need their own count. */
export function wholeNoteHtml(durationBeats: number | undefined, numerator: number | undefined, denominator: number | undefined): string;
/** Opt-in sequential-release explanation, never inferred for independent held voices. */
export function handHandoffHtml(profile: unknown, previousHand: unknown, currentHand: unknown): string;
/** Only for the explicit common-release MIDI contract; not inferred for independent voices. */
export function chordReleaseHtml(timingPrecision: unknown, midis: readonly number[] | null | undefined): string;
/** Explicit flat-name lesson only; relates one black piano key to the current sharp key label. */
export function flatNameHtml(profile: unknown, midis: readonly number[] | null | undefined): string;
export type AttemptMode = 'practice' | 'challenge' | 'memory';
/** Visible only during assisted blind practice; never contains answer data. */
export function blindPracticeHtml(enabled: boolean, mode: AttemptMode, eligible: boolean): string;
