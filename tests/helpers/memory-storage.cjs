'use strict';
// A synthetic durable store: successful setItem is observable by getItem.
// Never use real localStorage or the user's trainer-content.json in node tests.
function createMemoryStorage(entries=[]){
  const data=new Map(entries);
  return {getItem:key=>data.get(key)??null,setItem(key,value){data.set(String(key),String(value));}};
}
module.exports={createMemoryStorage};
