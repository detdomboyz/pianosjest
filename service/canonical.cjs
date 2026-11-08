'use strict';
const {createHash}=require('node:crypto');
function canonical(value){
  return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
module.exports={canonical,hash};
