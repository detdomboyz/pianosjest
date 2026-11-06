import type {HydratedLesson,Requirement} from './piano-preparation';
export as namespace PianoPreparationFragment;
export const TARGET_IDS:readonly string[];
export interface Selection {readonly requirement:Requirement;readonly planId:string;readonly hand:'right'|'left';readonly preparationIds:readonly string[];readonly title:string;readonly goal:string;readonly practiceSteps:readonly string[];readonly selfCheck:readonly string[]}
/** Only the reviewed musical editions; labels/descriptions may be personal. */
export function prepare(lesson:HydratedLesson):Selection|null;
