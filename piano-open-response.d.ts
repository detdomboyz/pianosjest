export interface OpenResponseContext {
  kind: 'open-response-v1';
  manualOnly: true;
  supported: true;
  hand: 'right' | 'left';
  readonly midis: readonly number[];
  readonly fingers: readonly number[];
  targetMidi: number;
  questionBeats: number;
  restBeats: number;
  answerBeats: number;
}
export interface UnsupportedOpenResponse {
  kind: 'open-response-v1';
  manualOnly: true;
  supported: false;
  reason: 'OPEN_RESPONSE_UNSUPPORTED';
}
/** Includes declared damaged/future protocols so they cannot fall into fixed-pattern grading. */
export function declared(lesson: unknown): boolean;
/** Pure metadata validation; never grades notes,timing,creativity or fingers. */
export function prepare(lesson: unknown): Readonly<OpenResponseContext> | Readonly<UnsupportedOpenResponse> | null;
