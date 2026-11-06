import type {Item} from './piano-reading-session';
import type {Clef} from './piano-staff-view';
export as namespace PianoReadingBank;
export const VERSION:2;
export interface SourceNote {readonly midi:number;readonly hand:'left'|'right';readonly finger:number;readonly startBeat:number;readonly durationBeats:number}
export interface BaseSpecification {readonly schemaVersion:1;readonly entries:readonly {readonly clef:Clef;readonly lessonId:string;readonly hand:'left'|'right';readonly demonstration:readonly SourceNote[];readonly transfer:readonly SourceNote[]}[]}
export interface CatalogAudit {readonly version:1;readonly scope:'builtin-piano-monophonic-windows-v1';readonly catalogRecords:number;readonly catalogHash:string;readonly items:readonly {readonly itemId:string;readonly contentKey:string;readonly occurrences:number}[]}
export interface Specification extends BaseSpecification {readonly catalogAudit:CatalogAudit}
export interface BankItem extends Item {readonly role:'bank'|'demonstration'|'transfer'|'catalog-exclusion';readonly hand:'left'|'right';readonly fingers:readonly (1|2|3|4|5)[]}
export interface CandidateBank {readonly schemaVersion:2;readonly items:readonly BankItem[];readonly publishedExamples:readonly BankItem[];readonly hands:Readonly<Record<Clef,'left'|'right'>>}
export interface Bank extends CandidateBank {readonly catalogAudit:CatalogAudit}
/** Construction alone does not establish eligibility. Only build() applies the source audit. */
export function candidates(specification:BaseSpecification):CandidateBank;
/** Six fixed adjacent-step/repeated-attack templates per clef; no extra counted lessons. */
export function build(specification:Specification):Bank;
