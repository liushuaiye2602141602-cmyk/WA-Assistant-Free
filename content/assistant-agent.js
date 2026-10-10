(function(g){
 'use strict';
 const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw new Error(r?.error||'后台连接失败');return r;};
 g.WAJobClient={rpc,async state(){return (await rpc({type:'WAA_STATE'})).state;}};
 let monitoring=false, currentAccount='';
 async function monitor(){
   if(monitoring)return;
   if(!await WABridge.waitReady(15000))return;
   currentAccount=await WABridge.call('assistantAccount'); if(!currentAccount)return;
   const config=await rpc({type:'WAA_CONFIG'});
   await WABridge.call('assistantWatch',{...config.settings,suppression:Object.keys(config.suppression[currentAccount]||{})});
   monitoring=true;await rpc({type:'WAA_READY'});
 }
 g.WAJobClient.refreshMonitor=async()=>{monitoring=false;await monitor();};
 window.addEventListener('WAA_page_event',e=>{
   const d=e.detail||{};
   if(d.type==='optout') rpc({type:'WAA_SUPPRESS',account:d.account,ids:d.ids}).catch(console.error);
   if(d.type==='receipt') for(const id of d.ids||[])rpc({type:'WAA_RECEIPT',account:d.account,id,ack:d.ack,groupVerified:!!d.groupVerified}).catch(console.error);
   if(d.type==='checkpoint') rpc({type:'WAA_CHECKPOINT',jobId:d.jobId,key:d.key,id:d.id,ack:d.ack}).then(()=>{
     window.dispatchEvent(new CustomEvent('WAA_checkpoint_saved',{detail:{token:d.token,ok:true}}));
   }).catch(error=>window.dispatchEvent(new CustomEvent('WAA_checkpoint_saved',{detail:{token:d.token,ok:false,error:error.message}})));
 });
 chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
   if(!['WAA_PROBE','WAA_EXEC','WAA_CANCEL'].includes(msg?.type))return;
   (async()=>{
     if(msg.type==='WAA_CANCEL'){await WABridge.call('assistantCancel',{jobId:msg.jobId});return {ok:true};}
     if(!await WABridge.waitReady(15000))return {ok:false,waiting:true,error:'WhatsApp 未就绪'};
     const account=await WABridge.call('assistantAccount');
     if(msg.type==='WAA_PROBE'){await monitor();return {ok:true,ready:true,account};}
     if(account!==msg.account)return {ok:false,waiting:true,error:'当前账号与任务账号不一致'};
     monitoring=false;await monitor();
     if(!(await rpc({type:'WAA_ALLOW',jobId:msg.jobId,key:msg.key,account})).allowed)return {ok:false,waiting:true,error:'任务停止、暂停或收件人已退订，等待重新调度'};
     try{
       return await WABridge.call('assistantSend',{id:msg.item.recipient.id,text:msg.item.text,files:msg.files,settings:msg.settings,account,jobId:msg.jobId,key:msg.key},180000);
     }catch(e){return {ok:false,uncertain:true,error:e.message};}
   })().then(respond,error=>respond({ok:false,uncertain:true,error:error.message}));
   return true;
 });
 setTimeout(()=>monitor().catch(console.error),2000);
 setInterval(async()=>{
   try{const account=await WABridge.call('assistantAccount',{},2000);if(account!==currentAccount){monitoring=false;currentAccount=account;}await monitor();}catch{monitoring=false;}
 },30000);
})(globalThis);
