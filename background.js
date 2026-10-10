importScripts('job-engine.js');
/**
 * Background service worker: relays popup actions to content script.
 */

async function getWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (tabs && tabs.length) return tabs[0];
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && active.url.startsWith("https://web.whatsapp.com/")) return active;
  return null;
}

async function openWhatsApp() {
  const existing = await getWhatsAppTab();
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return existing;
  }
  return chrome.tabs.create({ url: "https://web.whatsapp.com/" });
}

async function sendToWA(message) {
  const tab = await getWhatsAppTab();
  if (!tab) {
    await openWhatsApp();
    return { ok: false, error: "Opened WhatsApp Web. Wait for chats to load, then try again." };
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, message);
    return res || { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: "Content script not ready. Refresh WhatsApp Web and try again.",
      detail: String(e && e.message ? e.message : e),
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "WABK_PING_BG") {
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "WABK_OPEN_WA" || msg.action === "open") {
    openWhatsApp().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action) {
    sendToWA({ type: msg.action }).then(sendResponse);
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  // popup is set, so this usually won't fire; keep as fallback
  if (tab && tab.url && tab.url.startsWith("https://web.whatsapp.com/")) {
    sendToWA({ type: "WABK_OPEN" });
  }
});

// All queue state lives in extension storage, independent of the visible page.
let wakeTimer;
const scheduler = new WAJobEngine({
  load: async () => (await chrome.storage.local.get('waaState')).waaState,
  save: state => chrome.storage.local.set({waaState:state}),
  now: () => Date.now(), random: () => Math.random(), id: () => crypto.randomUUID(),
  wake: async when => {
    const at=Math.max(Date.now()+100,when);
    await chrome.alarms.create('waa-dispatch',{when:at});
    clearTimeout(wakeTimer);
    wakeTimer=setTimeout(()=>startup.then(()=>scheduler.tick()).catch(console.error),Math.min(2147483647,Math.max(100,at-Date.now())));
  },
  cancel: async jobId => {
    const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
    await Promise.allSettled(tabs.map(tab=>chrome.tabs.sendMessage(tab.id,{type:'WAA_CANCEL',jobId})));
  },
  execute: async (job,item) => {
    let tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});
    if(!tabs.length) {await chrome.tabs.create({url:'https://web.whatsapp.com/',active:false});return {waiting:true,error:'正在重新打开 WhatsApp，等待登录和连接'};}
    let selected;
    for(const tab of tabs) {
      try {const probe=await chrome.tabs.sendMessage(tab.id,{type:'WAA_PROBE'});if(probe?.ready&&probe.account===job.account){selected=tab;break;}} catch { /* content not ready */ }
    }
    if(!selected) return {waiting:true,error:'等待绑定账号的 WhatsApp 页面就绪；不会切换账号发送'};
    return chrome.tabs.sendMessage(selected.id,{type:'WAA_EXEC',jobId:job.id,key:item.key,account:job.account,item,files:job.files,settings:job.settings});
  }
});
const startup=scheduler.recover();
startup.catch(console.error);
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='waa-dispatch'||alarm.name==='waa-watchdog') startup.then(()=>scheduler.tick()).catch(console.error);});
chrome.alarms.create('waa-watchdog',{periodInMinutes:0.5});
chrome.runtime.onStartup.addListener(()=>startup.then(()=>scheduler.tick()).catch(console.error));
chrome.tabs.onUpdated.addListener((_id,change,tab)=>{if(change.status==='complete'&&tab.url?.startsWith('https://web.whatsapp.com/')) startup.then(()=>scheduler.tick()).catch(console.error);});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(!msg?.type?.startsWith('WAA_')) return;
  if(sender.id!==chrome.runtime.id) return;
  const run=async()=>{
    await startup;
    if(msg.type==='WAA_CREATE') {const job=await scheduler.create(msg.payload);void scheduler.tick().catch(console.error);return {job};}
    if(msg.type==='WAA_COMMAND') {const job=await scheduler.command(msg.jobId,msg.command);void scheduler.tick().catch(console.error);return {job};}
    if(msg.type==='WAA_STATE') {await scheduler.serial;return {state:await scheduler.io.load()||{jobs:[],suppression:{}}};}
    if(msg.type==='WAA_ALLOW') return {allowed:await scheduler.canSend(msg.jobId,msg.key,msg.account)};
    if(msg.type==='WAA_CONFIG') {
      const data=await chrome.storage.local.get(['waaSettings','waaState']);
      return {settings:data.waaSettings||{autoOptout:true,keywords:['退订','取消订阅','stop','unsubscribe','不要再发']},suppression:data.waaState?.suppression||{}};
    }
    if(msg.type==='WAA_SETTINGS') {
      const keywords=Array.isArray(msg.keywords)?msg.keywords.map(x=>String(x).trim().toLowerCase()).filter(Boolean).slice(0,30):[];
      if(!keywords.length) throw new Error('退订关键词不能为空');
      await chrome.storage.local.set({waaSettings:{autoOptout:!!msg.autoOptout,keywords}});
      return {};
    }
    if(msg.type==='WAA_SUPPRESS') {await scheduler.suppress(msg.account,msg.ids||[]);return {};}
    if(msg.type==='WAA_UNSUPPRESS') {await scheduler.unsuppress(msg.account,msg.id);return {};}
    if(msg.type==='WAA_CHECKPOINT') {await scheduler.checkpoint(msg.jobId,msg.key,msg.id,msg.ack);return {};}
    if(msg.type==='WAA_RECEIPT') {await scheduler.receipt(msg.account,msg.id,msg.ack,!!msg.groupVerified);return {};}
    if(msg.type==='WAA_READY') {void scheduler.tick().catch(console.error);return {};}
    throw new Error('未知后台操作');
  };
  run().then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message||String(error)}));
  return true;
});
