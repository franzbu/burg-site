import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { build } from 'esbuild';
const root=new URL('../', import.meta.url).pathname;
const output=pathToFileURL((await mkdtemp(join(tmpdir(), 'burg-tests-'))) + '/');
after(() => rm(output, { recursive: true, force: true }));
globalThis.__burgMockEnv={HISTORY_API_TOKEN:'mock-history',UPLOAD_SECRET:'mock-upload'};
for(const [name,path] of Object.entries({status:'src/pages/api/status.ts',temperature:'src/pages/api/temperature.ts',deletion:'src/pages/api/delete-image.ts',proxy:'src/pages/api/[...path].ts',http:'src/lib/burg/http.ts',locale:'src/lib/burg/locale.ts'})){
 await build({entryPoints:[`${root}/${path}`],outfile:new URL(`${name}.mjs`,output).pathname,bundle:true,platform:'node',format:'esm',plugins:[{name:'mock-worker-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env=globalThis.__burgMockEnv;',loader:'js'}));}}]});
}
const status=await import(new URL('status.mjs',output));
const temperature=await import(new URL('temperature.mjs',output));
const deletion=await import(new URL('deletion.mjs',output));
const proxy=await import(new URL('proxy.mjs',output));
const {numberOrNull,booleanOrNull}=await import(new URL('http.mjs',output));
const {resolveBurgLanguage}=await import(new URL('locale.mjs',output));
const route=(path,method='GET',headers={})=>({request:new Request('https://burg.gitor.uk'+path,{method,headers})});
test('unknown numeric and boolean states never become zero or false',()=>{
 for(const value of [null,undefined,'',' ','unknown',false,{},NaN,Infinity])assert.equal(numberOrNull(value),null);
 assert.equal(numberOrNull('0'),0);assert.equal(numberOrNull('-1.5'),-1.5);
 assert.equal(booleanOrNull('unknown'),null);assert.equal(booleanOrNull('off'),false);assert.equal(booleanOrNull('on'),true);
});
test('language weights and explicit exclusions are respected',()=>{
 assert.equal(resolveBurgLanguage('de;q=0.1,it-IT;q=0.9,en;q=0.5'),'it');
 assert.equal(resolveBurgLanguage('en;q=0,de;q=0.8'),'de');
 assert.equal(resolveBurgLanguage('fr,en-US;q=0.8'),'en');
 assert.equal(resolveBurgLanguage(null),'de');
});
test('history rejects unsupported entities without contacting the backend',async()=>{
 globalThis.fetch=()=>{throw Error('must not fetch')};
 const response=await temperature.GET(route('/api/temperature?entity_id=unrelated.sensor'));
 assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('history drops null/invalid samples, retains zero, and keeps energy precision',async()=>{
 globalThis.fetch=async()=>Response.json({hourly:[{start:'2026-10-15T00:00:00Z',mean:null},{start:'2026-10-15T01:00:00Z',mean:0},{start:'not-a-date',mean:1}],daily:[{start:'2026-10-15T00:00:00Z',mean:'0.12',min:'',max:0.18}],monthly:[]});
 const response=await temperature.GET(route('/api/temperature?entity_id=sensor.switching_and_measuring_cable_outdoor_energy_counter'));
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.hourly.length,1);assert.equal(data.hourly[0].mean,0);assert.equal(data.daily[0].mean,0.12);assert.equal(data.daily[0].min,null);
});
test('status preserves unknown flags and safely normalizes missing chart values',async()=>{
 globalThis.fetch=async(input)=>Response.json(String(input).includes('/live-status')?{weather_station:{temp:'12.3',is_raining:false,is_stormy:'unknown'},watchdog_active:'unknown'}:{irrigation:{today:'',is_active:'unknown'},daily_rain_14d:[{date:'15.10',value:null},{date:'14.10',value:0}],historical_acute_rain:{2026:{Oktober:{percentage:null,minutes:null}}}});
 const response=await status.GET({});assert.equal(response.status,200);const data=await response.json();assert.equal(data.weather_station.temp,12.3);assert.equal(data.weather_station.is_stormy,null);assert.equal(data.greenhouse.watchdog_active,null);assert.equal(data.irrigation.is_active,null);assert.equal(data.irrigation.today,null);assert.equal(data.daily_rain_14d.length,1);assert.equal(data.daily_rain_14d[0].value,0);assert.equal(data.historical_acute_rain['2026'].Oktober,null);
});
test('upstream failures use non-success status and never expose internal errors',async()=>{
 globalThis.fetch=async()=>{throw Error('private internal address or token')};
 for(const response of [await status.GET({}),await temperature.GET(route('/api/temperature?entity_id=sensor.weather_sensor_plus_garten_temperature'))]){
  assert.equal(response.status,502);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('private'));
 }
});
test('deletion rejects empty, traversal, arbitrary prefixes, and cross-origin targets without deleting',async()=>{
 globalThis.fetch=()=>{throw Error('must not fetch')};
 for(const path of ['/api/delete-image','/api/delete-image?prefix=','/api/delete-image?prefix=other_','/api/delete-image?file=../secret','/api/delete-image?file=mountain_a.webp&prefix=mountain_'])assert.equal((await deletion.DELETE(route(path,'DELETE'))).status,400,path);
 assert.equal((await deletion.DELETE(route('/api/delete-image?prefix=mountain_','DELETE',{Origin:'https://other.example'}))).status,403);
});
test('valid deletion retains the existing contract using only mocked requests',async()=>{
 let received;globalThis.fetch=async(url,options)=>{received={url:String(url),options};return Response.json({success:true})};
 const response=await deletion.DELETE(route('/api/delete-image?file=mountain_20261015_153000.webp','DELETE',{Origin:'https://burg.gitor.uk'}));assert.equal(response.status,200);assert.ok(received.url.endsWith('/mountain_20261015_153000.webp'));assert.equal(received.options.method,'DELETE');
});
test('generic proxy streams binary responses without text corruption',async()=>{
 const bytes=new Uint8Array([0,255,128,42]);globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'image/webp'}});
 const response=await proxy.ALL({...route('/api/image.webp'),params:{path:'image.webp'}});assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('access-control-allow-origin'),null);
});
