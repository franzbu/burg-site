import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/sw.js', import.meta.url),'utf8');
const handlers={};const deleted=[];
const context={URL,Response,Promise,caches:{keys:async()=>['burg-v1','burg-v2','unrelated-cache'],delete:async name=>{deleted.push(name);return true},open:async()=>({add:async()=>{},match:async()=>new Response('Offline')})},fetch:async()=>{throw Error('offline')},self:{location:{origin:'https://burg.gitor.uk'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,handler)=>handlers[name]=handler}};
vm.runInNewContext(source,context);
test('service worker never intercepts API calls or cross-origin requests',()=>{
 let intercepted=false;const respondWith=()=>{intercepted=true};
 for(const request of [{method:'GET',mode:'cors',url:'https://burg.gitor.uk/api/status'},{method:'GET',mode:'navigate',url:'https://other.example/'},{method:'DELETE',mode:'cors',url:'https://burg.gitor.uk/api/delete-image'}])handlers.fetch({request,respondWith});
 assert.equal(intercepted,false);
});
test('offline navigation always receives an actual offline response',async()=>{
 let response;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://burg.gitor.uk/'},respondWith:promise=>response=promise});
 assert.equal(await (await response).text(),'Offline');
});
test('activation removes only obsolete Burg caches',async()=>{
 let done;handlers.activate({waitUntil:promise=>done=promise});await done;assert.deepEqual(deleted,['burg-v1']);
});
