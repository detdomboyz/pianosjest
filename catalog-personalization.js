(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CatalogPersonalization=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VERSION=1,KIND='melodiajest-personal-catalog',MAX_BYTES=2*1024*1024;
  const reserved=new Set(['__proto__','prototype','constructor']);
  const object=x=>Boolean(x&&typeof x==='object'&&!Array.isArray(x));
  const clone=x=>JSON.parse(JSON.stringify(x));
  const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
  const assert=(ok,code)=>{if(!ok){const e=new Error(code);e.code=code;throw e;}};
  function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
  const equal=(a,b)=>stable(a)===stable(b);
  function safe(value,depth=0){assert(depth<=40,'PERSONAL_CATALOG_DEPTH');if(value&&typeof value==='object')for(const k of Object.keys(value)){assert(!reserved.has(k),'PERSONAL_CATALOG_FIELD');safe(value[k],depth+1);}}
  function records(values,max){assert(Array.isArray(values)&&values.length<=max,'PERSONAL_CATALOG_RECORDS');const map=new Map();for(const value of values){assert(object(value)&&typeof value.id==='string'&&value.id.length>0&&value.id.length<=200&&!reserved.has(value.id)&&!map.has(value.id),'PERSONAL_CATALOG_ID');map.set(value.id,value);}return map;}
  function snapshot(value){assert(object(value)&&value.version===7,'PERSONAL_CATALOG_VERSION');records(value.themes,2000);records(value.lessons,20000);safe(value);return value;}
  function slot(value,key){return own(value,key)?{present:true,value:clone(value[key])}:{present:false};}
  function diffFields(before,after,excluded=[]){const changes=[];for(const key of new Set([...Object.keys(before),...Object.keys(after)])){if(excluded.includes(key))continue;const a=slot(before,key),b=slot(after,key);if(!equal(a,b))changes.push({key,before:a,after:b});}return changes;}
  function diffTable(before,after,max){const original=records(before,max),current=records(after,max),created=[],patches=[],removed=[];
    for(const row of after){const prior=original.get(row.id);if(!prior)created.push(clone(row));else{const fields=diffFields(prior,row,['id']);if(fields.length)patches.push({id:row.id,fields});}}
    for(const row of before)if(!current.has(row.id))removed.push(row.id);
    return {order:after.map(row=>row.id),created,patches,removed};
  }
  function create(base,current,{baseRelease}={}){
    // JSON projection intentionally preserves arrays and finite JSON values;
    // undefined runtime-only properties are absent in the catalog protocol.
    base=clone(snapshot(base));current=clone(snapshot(current));
    const value={version:VERSION,kind:KIND,baseRelease,savedAt:current.savedAt||null,
      themes:diffTable(base.themes,current.themes,2000),lessons:diffTable(base.lessons,current.lessons,20000),
      fields:diffFields(base,current,['version','savedAt','themes','lessons'])};
    validate(value);return value;
  }
  function ids(values,max){assert(Array.isArray(values)&&values.length<=max,'PERSONAL_CATALOG_IDS');const set=new Set();for(const id of values){assert(typeof id==='string'&&id.length>0&&id.length<=200&&!reserved.has(id)&&!set.has(id),'PERSONAL_CATALOG_ID');set.add(id);}return set;}
  function changes(values,excluded){assert(Array.isArray(values)&&values.length<=100,'PERSONAL_CATALOG_FIELDS');const names=new Set();for(const value of values){assert(object(value)&&typeof value.key==='string'&&!reserved.has(value.key)&&!excluded.includes(value.key)&&!names.has(value.key),'PERSONAL_CATALOG_FIELD');names.add(value.key);for(const side of ['before','after'])assert(object(value[side])&&typeof value[side].present==='boolean'&&(value[side].present===own(value[side],'value')),'PERSONAL_CATALOG_SLOT');}}
  function validate(value){
    assert(object(value)&&value.kind===KIND&&value.version===VERSION&&typeof value.baseRelease==='string'&&/^\d+\.\d+\.\d+$/.test(value.baseRelease),'PERSONAL_CATALOG_VERSION');
    assert(new TextEncoder().encode(JSON.stringify(value)).length<=MAX_BYTES,'PERSONAL_CATALOG_SIZE');safe(value);
    for(const name of ['themes','lessons']){const table=value[name],max=name==='themes'?2000:20000;assert(object(table),'PERSONAL_CATALOG_TABLE');const ordered=ids(table.order,max),removed=ids(table.removed,max),created=records(table.created,max);
      assert(Array.isArray(table.patches)&&table.patches.length<=max,'PERSONAL_CATALOG_PATCHES');const patched=new Set();
      for(const row of table.created)assert(ordered.has(row.id)&&!removed.has(row.id),'PERSONAL_CATALOG_CREATED');
      for(const id of removed)assert(!ordered.has(id)&&!created.has(id),'PERSONAL_CATALOG_REMOVED');
      for(const patch of table.patches){assert(object(patch)&&typeof patch.id==='string'&&ordered.has(patch.id)&&!created.has(patch.id)&&!removed.has(patch.id)&&!patched.has(patch.id),'PERSONAL_CATALOG_PATCH');patched.add(patch.id);changes(patch.fields,['id']);}
    }
    changes(value.fields,['version','savedAt','themes','lessons']);return value;
  }
  function applyChanges(record,fields,id,conflicts){for(const field of fields){const current=slot(record,field.key);if(!equal(current,field.before)&&!equal(current,field.after)){conflicts.push({code:'PERSONAL_CATALOG_FIELD_CONFLICT',id,key:field.key});continue;}
      if(field.after.present)record[field.key]=clone(field.after.value);else delete record[field.key];}}
  function applyTable(base,table,max,name,conflicts){const map=records(clone(base),max);for(const id of table.removed)map.delete(id);
    for(const row of table.created){if(map.has(row.id)&&!equal(map.get(row.id),row))conflicts.push({code:'PERSONAL_CATALOG_ID_CONFLICT',id:row.id,key:name});else map.set(row.id,clone(row));}
    for(const patch of table.patches){const row=map.get(patch.id);if(!row){conflicts.push({code:'PERSONAL_CATALOG_BASE_MISSING',id:patch.id,key:name});continue;}applyChanges(row,patch.fields,patch.id,conflicts);}
    const result=[];for(const id of table.order){if(map.has(id)){result.push(map.get(id));map.delete(id);}}
    result.push(...map.values());return result;
  }
  function apply(base,personal){snapshot(base);validate(personal);const result=clone(base),conflicts=[];
    result.themes=applyTable(base.themes,personal.themes,2000,'themes',conflicts);result.lessons=applyTable(base.lessons,personal.lessons,20000,'lessons',conflicts);applyChanges(result,personal.fields,'catalog',conflicts);result.savedAt=personal.savedAt;
    const themeIds=new Set(result.themes.map(row=>row.id));for(const row of result.lessons)if(!themeIds.has(row.themeId))conflicts.push({code:'PERSONAL_CATALOG_THEME_MISSING',id:row.id,key:'themeId'});
    return conflicts.length?{ok:false,conflicts,snapshot:null}:{ok:true,conflicts:[],snapshot:result};
  }
  return Object.freeze({VERSION,KIND,MAX_BYTES,create,validate,apply,equivalent:(a,b)=>equal(clone(a),clone(b))});
});
