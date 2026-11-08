export as namespace PortalExperience;
export const VERSION:1;
export interface Level {readonly level:number;readonly nextLevel:number;readonly xp:number;readonly levelStartXp:number;readonly nextLevelXp:number;readonly remaining:number;readonly progress:number}
export function level(xp:number):Level;
export function award(input:{clean:boolean;quality:number}):number;
export function improvement(previous:number,best:number):{best:number;delta:number};
