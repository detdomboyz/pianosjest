'use strict';
// Frozen teaching-review fixtures describe an earlier catalog cohort.
// Keep every original ID and its relative order testable as new lessons arrive.
// Current inventory size is asserted separately from piano-curriculum-counts.json.
function ids(lessons,cohort){
 const actual=Array.from(lessons,l=>l.id),expected=Array.from(cohort,l=>l.id);
 if(new Set(actual).size!==actual.length||new Set(expected).size!==expected.length)throw Error('Duplicate catalog identity');
 const original=new Set(expected);return actual.filter(id=>original.has(id));
}
module.exports={ids};
