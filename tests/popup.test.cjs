const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/liush/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:360,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(fs.readFileSync(path.join(base,'popup/popup.html'),'utf8').replace(/<script[^>]*src="popup.js"[^>]*><\/script>/,''));
  await page.addStyleTag({path:path.join(base,'popup/popup.css')});
  await page.evaluate(()=>{
   window.__actions=[];
   window.chrome={tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,ready:true,chats:12})},runtime:{sendMessage:async msg=>{window.__actions.push(msg.action);return {ok:true};}}};
  });
  await page.addScriptTag({path:path.join(base,'popup/popup.js')});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('12'));
  await page.locator('#btn-open').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='面板已打开');
  await page.locator('#btn-export-active').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('正在导出'));
  await page.locator('#btn-open-wa').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='已打开 WhatsApp Web');
  assert.deepEqual(await page.evaluate(()=>window.__actions),['WABK_OPEN','WABK_EXPORT_ACTIVE','open']);
  await page.evaluate(()=>chrome.runtime.sendMessage=async()=>{throw new Error('disconnected');});
  await page.locator('#btn-open').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('连接中断'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(base,'弹出窗口预览.png'),animations:'disabled'});
  console.log('PASS: actual popup buttons, action payloads, status, disconnect handling and 360px layout. Mock transport only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
