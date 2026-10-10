const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('C:/Users/liush/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><body><div id="panel"><nav class="waa-nav"></nav></div><div id="main" style="margin:80px"><header>Alice</header><div class="message-in" style="width:240px;margin:30px"><div class="copyable-text" style="padding:20px;background:#eee">Hello</div></div><div class="message-out" style="padding:20px;width:240px;margin:30px">Outgoing</div><footer><div contenteditable="true" role="textbox" style="border:1px solid gray;padding:20px">现有草稿</div><button id="send">发送</button></footer></div></body></html>');
 await page.evaluate(()=>{
   window.__sent=0;document.querySelector('#send').onclick=()=>window.__sent++;
   window.chrome={storage:{local:{get:async()=>({}),set:async d=>window.__saved=structuredClone(d.waaQuickReplies)}}};
   window.WAUI={buildPanel:()=>document.querySelector('#panel')};
 });
 await page.addStyleTag({path:path.join(base,'content/quick-replies.css')});await page.addScriptTag({path:path.join(base,'content/quick-replies.js')});
 await page.evaluate(()=>{WAUI.buildPanel();WAQuickReplies.init();});
 await page.locator('.message-out').hover();assert.equal(await page.locator('#waqr-hover').isVisible(),false);
 await page.locator('.message-in').hover();assert.equal(await page.locator('.waqr-trigger').isVisible(),true);await page.locator('.waqr-trigger').click();
 await page.getByRole('button',{name:/中文问候/}).click();assert.match(await page.locator('footer [contenteditable]').textContent(),/现有草稿[\s\S]*您好/);assert.equal(await page.evaluate(()=>window.__sent),0);
 await page.getByRole('button',{name:'回复语设置',exact:true}).click();await page.locator('#waqr-title').fill('定制报价');await page.locator('#waqr-text').fill('第一行\n第二行 <img src=x onerror=alert(1)>');await page.locator('#waqr-save').click();
 await page.waitForFunction(()=>window.__saved?.replies.some(r=>r.title==='定制报价'));assert.equal(await page.locator('.waqr-managed img').count(),0);
 await page.locator('#waqr-enabled').uncheck();await page.waitForFunction(()=>window.__saved?.enabled===false);await page.getByRole('button',{name:'关闭快捷回复设置'}).click();await page.locator('.message-in').hover();assert.equal(await page.locator('#waqr-hover').isVisible(),false);
 await page.getByRole('button',{name:'回复语设置',exact:true}).click();await page.locator('#waqr-enabled').check();await page.waitForFunction(()=>window.__saved?.enabled===true);await page.getByRole('button',{name:'关闭快捷回复设置'}).click();
 await page.locator('.message-in').hover();await page.locator('.waqr-trigger').click();
 await page.evaluate(()=>{document.querySelector('#main header').textContent='Bob';document.querySelector('footer [contenteditable]').textContent='另一会话草稿';});
 await page.waitForFunction(()=>document.querySelector('#waqr-hover').hidden);assert.equal(await page.locator('footer [contenteditable]').textContent(),'另一会话草稿');
 await page.setViewportSize({width:390,height:700});await page.locator('.message-in').hover();await page.locator('.waqr-trigger').click();const rect=await page.locator('.waqr-popover').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390);
 await page.keyboard.press('Escape');assert.equal(await page.locator('.waqr-popover').isVisible(),false);assert.equal(await page.evaluate(()=>window.__sent),0);assert.deepEqual(errors,[]);
 await page.locator('#waqr-fixed-entry').click();assert.equal(await page.locator('.waqr-popover').isVisible(),true);await page.getByRole('button',{name:/稍后回复/}).click();assert.match(await page.locator('footer [contenteditable]').textContent(),/另一会话草稿[\s\S]*get back to you/);
 await page.evaluate(()=>{document.querySelector('.message-in').className='modern-message';document.querySelector('.modern-message').dataset.id='false_123456789@c.us_MESSAGE';});
 await page.locator('[data-id^="false_"]').hover();assert.equal(await page.locator('.waqr-trigger').isVisible(),true);
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('#main').removeAttribute('id'));await page.locator('#waqr-fixed-entry').click();assert.equal(await page.locator('.waqr-popover').isVisible(),true);assert.equal(await page.evaluate(()=>window.__sent),0);
 await page.keyboard.press('Escape');await page.evaluate(()=>document.querySelector('.modern-message').parentElement.id='main');
 await page.setViewportSize({width:1000,height:700});await page.locator('#waqr-fixed-entry').click();await page.screenshot({path:path.join(base,'快捷回复预览.png'),fullPage:true});
 console.log('PASS: incoming-only hover, draft insertion/preservation, no send, local reply editing, disable/re-enable, conversation-switch protection, narrow-screen placement.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
