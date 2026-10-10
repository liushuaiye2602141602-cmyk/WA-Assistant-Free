const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../job-engine.js'),'utf8'));
const clone=o=>JSON.parse(JSON.stringify(o));
function harness(){let state,now=100000,id=0;const sent=[],wakes=[];
 const engine=new WAJobEngine({load:async()=>clone(state||{jobs:[],suppression:{}}),save:async s=>{state=clone(s);},now:()=>now,id:()=>String(++id),random:()=>0,wake:async t=>wakes.push(t),execute:async(j,i)=>{sent.push(i.recipient.id);return {ok:true,messageIds:[j.id+':'+i.key],receipts:{[j.id+':'+i.key]:1}};}});
 return {engine,sent,wakes,get state(){return state;},set state(v){state=clone(v);},advance(ms){now+=ms;},payload(overrides={}){return {account:'8613800000000@c.us',consent:true,items:[{recipient:{id:'84900000000@c.us',name:'A'},text:'hello'},{recipient:{id:'84900000001@c.us',name:'B'},text:'hello'}],minMs:1000,maxMs:2000,scheduledAt:now,deleteMode:'none',...overrides};}};
}
(async()=>{
 let h=harness();const j=await h.engine.create(h.payload({scheduledAt:110000}));await h.engine.tick();assert.equal(h.sent.length,0);h.advance(10000);await h.engine.tick();assert.equal(h.sent.length,1);await h.engine.tick();assert.equal(h.sent.length,1);h.advance(1000);await h.engine.tick();assert.equal(h.sent.length,2);assert.equal(h.state.jobs[0].status,'completed');
 await h.engine.receipt(j.account,j.id+':0',3);await h.engine.receipt(j.account,j.id+':0',1);assert.equal(h.state.jobs[0].items[0].receipts[j.id+':0'],3);
 h=harness();const group=await h.engine.create(h.payload({items:[{recipient:{id:'123456-789@g.us'},text:'group'}]}));await h.engine.tick();const groupId=group.id+':0';await h.engine.receipt(group.account,groupId,3);assert.equal(h.state.jobs[0].items[0].receipts[groupId],1);await h.engine.receipt(group.account,groupId,3,true);assert.equal(h.state.jobs[0].items[0].receipts[groupId],3);
 h=harness();const p=await h.engine.create(h.payload());await h.engine.command(p.id,'pause');await h.engine.tick();assert.equal(h.sent.length,0);await h.engine.command(p.id,'resume');await h.engine.suppress(p.account,['84900000000@c.us']);await h.engine.tick();assert.deepEqual(h.sent,['84900000001@c.us']);assert.equal(h.state.jobs[0].items[0].status,'optedout');
 h=harness();const stopped=await h.engine.create(h.payload());await h.engine.command(stopped.id,'stop');await h.engine.tick();assert.equal(h.sent.length,0);
 h=harness();await h.engine.create(h.payload());const saved=h.state;saved.jobs[0].items[0].status='sending';saved.jobs[0].status='running';h.state=saved;await h.engine.recover();await h.engine.tick();assert.equal(h.sent.length,0);assert.equal(h.state.jobs[0].items[0].status,'uncertain');await h.engine.command('1','resume');await h.engine.tick();assert.deepEqual(h.sent,['84900000001@c.us']);
 h=harness();await h.engine.create(h.payload());h.engine.io.execute=async()=>{throw new Error('transport timeout');};await h.engine.tick();assert.equal(h.state.jobs[0].status,'attention');assert.equal(h.state.jobs[0].items[0].status,'uncertain');await h.engine.command('1','retry');assert.equal(h.state.jobs[0].items[0].status,'uncertain');
 h=harness();const partial=await h.engine.create(h.payload());h.engine.io.execute=async(job,item)=>{await h.engine.receipt(job.account,'early-id',3);await h.engine.checkpoint(job.id,item.key,'early-id',1);return {ok:false,error:'attachment failed',messageIds:['early-id'],receipts:{'early-id':1}};};await h.engine.tick();assert.equal(h.state.jobs[0].items[0].receipts['early-id'],3);assert.equal(h.state.jobs[0].items[0].status,'uncertain');
 h=harness();await h.engine.create(h.payload());h.engine.io.execute=async()=>({waiting:true,error:'not logged in'});await h.engine.tick();assert.equal(h.state.jobs[0].items[0].status,'pending');assert.equal(h.state.jobs[0].status,'waiting');
 for(const response of [null,undefined,{ok:true}]) {
   h=harness();await h.engine.create(h.payload());h.engine.io.execute=async()=>response;
   await h.engine.tick();assert.equal(h.state.jobs[0].status,'attention');assert.equal(h.state.jobs[0].items[0].status,'uncertain');
   await h.engine.tick();assert.equal(h.state.jobs[0].items[1].status,'pending');
 }
 for(const status of ['stopped','paused']) {
   h=harness();await h.engine.create(h.payload());const interrupted=h.state;
   interrupted.jobs[0].status=status;interrupted.jobs[0].items[0].status='sending';h.state=interrupted;
   await h.engine.recover();assert.equal(h.state.jobs[0].status,status);assert.equal(h.state.jobs[0].items[0].status,'uncertain');
   await h.engine.tick();assert.equal(h.sent.length,0);
 }
 h=harness();await assert.rejects(h.engine.create(h.payload({deleteMode:'chat',deleteConfirmed:false})),/确认/);await assert.rejects(h.engine.create(h.payload({consent:false})),/确认/);
 const durable=await h.engine.create(h.payload({deleteMode:'messages',deleteConfirmed:true}));h.engine.io.execute=async(job,item)=>{assert.equal(await h.engine.canSend(job.id,item.key,job.account),true);await h.engine.command(job.id,'stop');assert.equal(await h.engine.canSend(job.id,item.key,job.account),false);return {ok:false,waiting:true};};await h.engine.tick();assert.equal(h.state.jobs[0].status,'stopped');
 for(const sequence of [[[3,true],[4,false]],[[4,false],[2,true]],[[3,true],[1,false]]]){
   h=harness();const job=await h.engine.create(h.payload({items:[{recipient:{id:'123456-789@g.us'},text:'group'}]}));
   for(const [ack,verified]of sequence)await h.engine.receipt(job.account,'cached-group',ack,verified);
   await h.engine.checkpoint(job.id,'0','cached-group',1);
   const expected=Math.max(...sequence.filter(x=>x[1]).map(x=>x[0]));
   assert.equal(h.state.jobs[0].items[0].receipts['cached-group'],expected);
 } console.log('PASS: scheduled dispatch, delay, persistence, pause/resume/stop, optout isolation, restart and timeout duplicate prevention, partial sends, monotonic receipts, deletion confirmation. No real sends.');
})().catch(e=>{console.error(e);process.exitCode=1;});
