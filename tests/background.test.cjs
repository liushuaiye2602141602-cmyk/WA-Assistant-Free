const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.resolve(__dirname,'..');
function host(){
 let now=100000,state={},nextTab=0;const tabs=[],sent=[],timers=[],listeners={messages:[],alarm:[]};
 const event=name=>({addListener:fn=>{(listeners[name]||=[]).push(fn);}});
 const chrome={runtime:{id:'test-extension',onMessage:event('messages'),onStartup:event('startup')},action:{onClicked:event('clicked')},alarms:{onAlarm:event('alarm'),create:async()=>{}},storage:{local:{get:async names=>{const keys=typeof names==='string'?[names]:names;return Object.fromEntries(keys.map(k=>[k,state[k]&&structuredClone(state[k])]));},set:async data=>Object.assign(state,structuredClone(data))}},tabs:{onUpdated:event('updated'),query:async()=>tabs,create:async data=>{const t={id:++nextTab,url:data.url,active:data.active};tabs.push(t);return t;},update:async()=>{},sendMessage:async(id,msg)=>{
   if(msg.type==='WAA_PROBE')return {ready:true,account:'8613800000000@c.us'};
   if(msg.type==='WAA_EXEC'){sent.push(msg);return {ok:true,messageIds:['msg-'+sent.length],receipts:{['msg-'+sent.length]:1}};}
   return {ok:true};
 }}};
 const FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const context=vm.createContext({chrome,console,crypto:{randomUUID:()=>String(Math.random())},Date:FakeDate,setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{}});
 context.importScripts=(file)=>vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context);
 return {tabs,sent,get state(){return state;},advance:ms=>now+=ms,alarm:()=>listeners.alarm.forEach(fn=>fn({name:'waa-watchdog'})),request:msg=>new Promise((resolve,reject)=>{let handled=false;for(const fn of listeners.messages){if(fn(msg,{id:'test-extension',url:'https://web.whatsapp.com/'},resolve))handled=true;}if(!handled)reject(new Error('unhandled'));})};
}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(setImmediate);}throw new Error('mock background timeout');}
(async()=>{
 const popup=host();assert.equal((await popup.request({action:'open'})).ok,true);assert.equal(popup.tabs.length,1);
 assert.equal((await popup.request({action:'WABK_OPEN'})).ok,true);
 assert.equal((await popup.request({action:'WABK_EXPORT_ACTIVE'})).ok,true);
 await assert.rejects(popup.request({action:'UNKNOWN_ACTION'}),/unhandled/);
 const h=host();const created=await h.request({type:'WAA_CREATE',payload:{account:'8613800000000@c.us',consent:true,items:[{recipient:{id:'84900000000@c.us'},text:'test'}],files:[],minMs:1000,maxMs:1000,scheduledAt:110000,deleteMode:'none'}});assert.equal(created.ok,true);assert.equal(h.sent.length,0);
 h.advance(10000);h.alarm();await until(()=>h.state.waaState?.jobs[0].status==='waiting');assert.equal(h.tabs.length,1);assert.equal(h.tabs[0].active,false);assert.equal(h.sent.length,0);
 h.advance(30000);h.alarm();await until(()=>h.state.waaState?.jobs[0].status==='completed');assert.equal(h.sent.length,1);
 await h.request({type:'WAA_RECEIPT',account:'8613800000000@c.us',id:'msg-1',ack:3});assert.equal(h.state.waaState.jobs[0].items[0].receipts['msg-1'],3);
 const ids=['84900000000@c.us','99999999999@lid'];await h.request({type:'WAA_SUPPRESS',account:'8613800000000@c.us',ids});assert.equal(Object.keys(h.state.waaState.suppression['8613800000000@c.us']).length,2);
 await h.request({type:'WAA_UNSUPPRESS',account:'8613800000000@c.us',id:ids[0]});assert.equal(Object.keys(h.state.waaState.suppression['8613800000000@c.us']).length,0);
 assert.equal((await h.request({type:'WAA_SETTINGS',autoOptout:true,keywords:[]})).ok,false);
 assert.equal((await h.request({type:'WAA_SETTINGS',autoOptout:false,keywords:['STOP']})).ok,true);assert.equal((await h.request({type:'WAA_CONFIG'})).settings.autoOptout,false);
 console.log('PASS: background RPC, persisted scheduling, inactive tab reopen, account probe, delayed execution, receipt persistence, optout alias restore. No real Chrome tabs or messages.');
})().catch(e=>{console.error(e);process.exitCode=1;});
