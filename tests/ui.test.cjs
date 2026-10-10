const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/liush/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = path.resolve(__dirname,'..');
(async()=>{
 const browser = await chromium.launch({headless:true,channel:'msedge'});
 try {
 const page = await browser.newPage({viewport:{width:1280,height:900}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><head></head><body style="background:#eef3f0"><h1 style="font:24px system-ui;padding:30px;color:#345">WhatsApp 助手 · 界面测试</h1><div id="main"></div></body></html>');
 await page.addStyleTag({path:path.join(base,'content/styles.css')}); await page.addStyleTag({path:path.join(base,'content/assistant.css')}); await page.addStyleTag({path:path.join(base,'content/quick-replies.css')}); await page.addStyleTag({path:path.join(base,'content/ui-polish.css')});
 await page.evaluate(()=>{
   window.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
   window.WABridge={waitReady:async()=>true,inject:()=>{},getChatList:async()=>[{id:'123456789@c.us',name:'Alice'}],call:async()=> '123456789@c.us'}; window.WAExporter={downloadBlob:()=>{}};
   const state={jobs:[],suppression:{}};
   window.WAJobClient={state:async()=>structuredClone(state),refreshMonitor:async()=>{},rpc:async msg=>{
     if(msg.type==='WAA_CONFIG')return {settings:{autoOptout:true,keywords:['退订']}};
     if(msg.type==='WAA_CREATE'){window.__lastPayload=structuredClone(msg.payload);window.__mockSends=(window.__mockSends||0)+msg.payload.items.length;const job={id:'test-job',...msg.payload,createdAt:Date.now(),status:'completed',settings:{},items:msg.payload.items.map((x,n)=>({...x,status:'submitted',messageIds:['test-'+n],receipts:{['test-'+n]:3}}))};state.jobs.push(job);return {job};}
     return {};
   }};
 });
 for(const file of ['content/ui.js','content/assistant-core.js','content/xlsx-reader.js','content/assistant-ui.js','content/quick-replies.js','content/ui-polish.js','lib/zip.js']) await page.addScriptTag({path:path.join(base,file)});
 await page.evaluate(()=>WAUI.setOpen(true));
 assert.equal(await page.locator('.waa-nav [data-tab]').count(),4);
 await page.getByRole('button',{name:'批量发送',exact:true}).click();
 await page.locator('#waa-numbers').fill('8613800000000,84900000000'); await page.locator('#waa-add').click();
 await page.locator('#waa-text').fill('你好 {{name}}'); await page.locator('#waa-preview-btn').click();
 await page.waitForFunction(()=>document.querySelector('#waa-start').disabled===false);
 assert.match(await page.locator('#waa-preview').textContent(),/8613800000000/);
 await page.locator('#waa-text').fill('修改'); assert.equal(await page.locator('#waa-preview').textContent(),''); assert.equal(await page.locator('#waa-start').isDisabled(),true);
 await page.locator('#waa-numbers').fill('8613900000000'); await page.locator('#waa-preview-btn').click();
 await page.waitForFunction(()=>document.querySelector('#waa-status').textContent.includes('号码已修改'));
 assert.equal(await page.locator('#waa-start').isDisabled(),true);
 await page.locator('#waa-add').click();
 const xlsxRows = await page.evaluate(async()=>{
   const z=new WAZip.ZipWriter();
   await z.add('xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contacts" r:id="rId1"/></sheets></workbook>');
   await z.add('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
   await z.add('xl/sharedStrings.xml','<sst><si><t>phone</t></si><si><t>name</t></si><si><t>Alice</t></si></sst>');
   await z.add('xl/worksheets/sheet1.xml','<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2"><v>8613800000000</v></c><c r="B2" t="s"><v>2</v></c></row></sheetData></worksheet>');
   return WAReadXlsx(new File([z.build()],'test.xlsx'));
 }); assert.deepEqual(xlsxRows,[['phone','name'],['8613800000000','Alice']]);
 const roundtrip = await page.evaluate(async()=>WAReadXlsx(new File([await WAWriteXlsx([['phone','name'],['8613800000000','张先生 & 伙伴']])],'roundtrip.xlsx')));
 assert.deepEqual(roundtrip,[['phone','name'],['8613800000000','张先生 & 伙伴']]);
 await page.locator('#waa-text').fill('你好 {{name}}，感谢您关注我们的包装产品。'); await page.locator('#waa-preview-btn').click();
 assert.equal(await page.locator('.waa-card').count(),4); await page.evaluate(()=>document.querySelector('.waa-tools').scrollTop=0); await page.screenshot({path:path.join(base,'界面预览.png'),fullPage:true});
 // Test the start button and double-click lock with a mock transport only.
 await page.evaluate(()=>{ window.__mockSends=0; WABridge.call=async name=>{ if(name==='assistantAccount'){await new Promise(r=>setTimeout(r,30));return 'test-account';} if(name==='assistantSend'){window.__mockSends++;return {submitted:true};} throw new Error('unexpected mock call'); }; });
 await page.locator('#waa-consent').check();
 await page.evaluate(()=>{document.querySelector('#waa-start').click();document.querySelector('#waa-start').click();setTimeout(()=>{document.querySelector('#waa-timestamp').checked=true;},10);});
 await page.waitForFunction(()=>document.querySelector('#waa-stats').textContent.includes('全部消息已读 1'));
 assert.equal(await page.evaluate(()=>window.__mockSends),1); assert.equal(await page.evaluate(()=>window.__lastPayload.timestamp),false); await page.locator('#waa-jobs').selectOption(''); await page.waitForFunction(()=>document.querySelector('#waa-stats').textContent.includes('请选择任务')); assert.equal(await page.locator('#waa-report').textContent(),''); assert.equal(await page.locator('#waa-report-export').isDisabled(),true); await page.locator('#waa-jobs').selectOption('test-job'); await page.waitForFunction(()=>document.querySelector('#waa-stats').textContent.includes('全部消息已读 1'));
 await page.evaluate(()=>{
   window.__micStopped=false;
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(resolve=>{window.__releaseMic=()=>resolve({getTracks:()=>[{stop:()=>window.__micStopped=true}]});})}});
   window.MediaRecorder=class{
     static isTypeSupported(){return true;}
     constructor(){this.state='inactive';this.mimeType='audio/webm';}
     start(){this.state='recording';}
     stop(){this.state='inactive';this.ondataavailable({data:new Blob(['mock-audio'],{type:'audio/webm'})});this.onstop();}
   };
 });
 await page.locator('#waa-record').click(); await page.waitForFunction(()=>!!window.__releaseMic); await page.locator('#waa-files-clear').click(); await page.waitForFunction(()=>document.querySelector('#waa-status').textContent.includes('完成后再清空')); await page.locator('#waa-preview-btn').click(); await page.waitForFunction(()=>document.querySelector('#waa-status').textContent.includes('附件或录音完成')); assert.equal(await page.locator('#waa-start').isDisabled(),true); await page.evaluate(()=>window.__releaseMic()); await page.waitForFunction(()=>document.querySelector('#waa-record-stop').disabled===false);await page.locator('#waa-record-stop').click();
 await page.waitForFunction(()=>document.querySelector('#waa-files-list').textContent.includes('录音_'));assert.equal(await page.evaluate(()=>window.__micStopped),true);
 assert.equal(await page.locator('#waa-record-preview').isVisible(),true); await page.evaluate(async()=>{
   const input=document.querySelector('#waa-files'),OriginalReader=window.FileReader;
   Object.defineProperty(input,'files',{configurable:true,value:[{name:'failed.txt',size:10,type:'text/plain'}]});
   window.FileReader=class{readAsDataURL(){queueMicrotask(()=>this.onabort());}};
   try{await input.onchange();}finally{window.FileReader=OriginalReader;delete input.files;}
 });
 assert.match(await page.locator('#waa-files-list').textContent(),/录音_/);
 assert.match(await page.locator('#waa-status').textContent(),/原附件已保留/);
 assert.equal(await page.locator('#waa-record-preview').isVisible(),true);
 await page.locator('#waa-files').setInputFiles({name:'replacement.txt',mimeType:'text/plain',buffer:Buffer.from('replacement')});
 await page.waitForFunction(()=>document.querySelector('#waa-files-list').textContent==='replacement.txt');
 assert.equal(await page.locator('#waa-record-preview').isVisible(),false);await page.locator('#waa-files-clear').click();
 await page.locator('#waa-buttons').fill('官网 | url | https://example.com');await page.locator('#waa-preview-btn').click();await page.waitForFunction(()=>document.querySelector('#waa-preview').textContent.includes('按钮：官网'));
 await page.getByRole('button',{name:'联系人',exact:true}).click(); assert.equal(await page.locator('#waa-contacts-load').isVisible(),true);
 await page.evaluate(()=>{
   WABridge.getChatList=async()=>[{id:'111111-11@g.us',name:'群一'},{id:'222222-22@g.us',name:'群二'}];
   const original=WABridge.call;
   WABridge.call=async(name,p)=>name==='assistantGroup'?p.id==='111111-11@g.us'?[{id:'111111111@c.us',phone:'111111111',name:'A'},{id:'222222222@c.us',phone:'222222222',name:'B'}]:[{id:'222222222@c.us',phone:'222222222',name:'B'},{id:'333333333@c.us',phone:'333333333',name:'C'}]:original(name,p);
 });
 await page.locator('#waa-groups-refresh').click();await page.waitForFunction(()=>document.querySelector('#waa-group').options.length===3);
 await page.locator('#waa-group').selectOption(['111111-11@g.us','222222-22@g.us']);await page.locator('#waa-source').selectOption('group');await page.locator('#waa-contacts-load').click();
 await page.waitForFunction(()=>document.querySelectorAll('#waa-contacts label').length===3); await page.evaluate(()=>{const previous=WABridge.call;window.__restoreContactBridge=previous;WABridge.call=async(name,p)=>{if(name==='assistantGroup'&&p.id==='222222-22@g.us')throw new Error('测试群读取失败');return previous(name,p);};});
 await page.locator('#waa-contacts-load').click();
 await page.waitForFunction(()=>document.querySelector('#waa-status').textContent.includes('测试群读取失败')); assert.equal(await page.locator('#waa-contacts-load').isDisabled(),false); assert.equal(await page.locator('#waa-source').isDisabled(),false);
 await page.evaluate(()=>{WAExporter.downloadBlob=blob=>{window.__contactExport=blob;};});
 await page.locator('#waa-contacts-export').click();
 await page.waitForFunction(()=>!!window.__contactExport);
 assert.equal(await page.evaluate(async()=>WAAssistantCore.parseCSV(await window.__contactExport.text()).length),4);
 await page.evaluate(()=>{WABridge.call=window.__restoreContactBridge;window.__contactExport=null;}); await page.locator('#waa-contacts-send').click(); await page.waitForFunction(()=>document.querySelector('#waa-recipient-summary').textContent.includes('333333333')); assert.equal(await page.locator('#waa-numbers').inputValue(),'');
 await page.getByRole('button',{name:'联系人',exact:true}).click(); await page.evaluate(()=>{WABridge.call=async name=>name==='assistantAccount'?'test-account':[{id:'123456789@lid',phone:'+639163803240',name:'joel'},{id:'639163803240@c.us',phone:'639163803240',name:'joel',saved:true}];}); await page.locator('#waa-source').selectOption('all'); await page.locator('#waa-contacts-load').click(); await page.waitForFunction(()=>document.querySelectorAll('#waa-contacts label').length===1); assert.match(await page.locator('#waa-status').textContent(),/已合并 1 条重复记录/); await page.evaluate(()=>WAExporter.downloadBlob=blob=>{window.__contactExport=blob;}); await page.locator('#waa-contacts-export').click(); await page.waitForFunction(()=>!!window.__contactExport); assert.equal(await page.evaluate(async()=>WAAssistantCore.parseCSV(await window.__contactExport.text()).length),2); await page.evaluate(()=>window.__contactExport=null); await page.getByRole('button',{name:'导出选中 Excel',exact:true}).click(); await page.waitForFunction(()=>!!window.__contactExport); assert.equal(await page.evaluate(async()=>(await WAReadXlsx(new File([window.__contactExport],'contacts.xlsx'))).length),2);  await page.evaluate(()=>{window.__contactCalls=0;const previous=WABridge.call;WABridge.call=async(name,p)=>{if(name==='assistantContacts'){window.__contactCalls++;await new Promise(resolve=>setTimeout(resolve,30));}return previous(name,p);}; document.querySelector('#waa-contacts-load').click();document.querySelector('#waa-contacts-load').click();});
 await page.waitForFunction(()=>window.__contactCalls===1&&!document.querySelector('#waa-contacts-load').disabled);
 assert.equal(await page.evaluate(()=>window.__contactCalls),1);await page.getByRole('button',{name:'隐私保护',exact:true}).click(); await page.locator('[data-privacy="messages"]').check();
 assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('waa-blur-messages')),true);
 await page.getByRole('button',{name:'聊天备份',exact:true}).click(); assert.equal(await page.locator('#wabk-export').isVisible(),true); await page.locator('.wabk-chat-row').first().focus();await page.keyboard.press('Space');
 assert.equal(await page.locator('.wabk-chat-row').first().getAttribute('aria-checked'),'true');
 assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('wabk-chat-row')),true);
 await page.keyboard.press('Enter');assert.equal(await page.locator('.wabk-chat-row').first().getAttribute('aria-checked'),'false'); assert.equal(await page.locator('#wabk-export').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(8, 127, 104)'); assert.equal(await page.locator('.waa-nav [data-tab=backup]').getAttribute('aria-pressed'),'true'); assert.match(await page.locator('.waa-nav [data-tab=backup]').evaluate(el=>getComputedStyle(el).backgroundColor),/^rgb\((8, 127, 104|6, 100, 82)\)$/); await page.screenshot({path:path.join(base,'备份界面预览.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844}); await page.getByRole('button',{name:'批量发送',exact:true}).click(); await page.evaluate(()=>document.querySelector('.waa-tools').scrollTop=0); await page.screenshot({path:path.join(base,'窄屏界面预览.png')}); assert.equal(await page.evaluate(()=>document.querySelector('.waa-tools').scrollWidth<=document.querySelector('.waa-tools').clientWidth),true); assert.equal(await page.locator('#waa-numbers').isVisible(),true); await page.waitForFunction(()=>document.querySelector('#waqr-fixed-entry').hidden); await page.locator('#waa-numbers').focus(); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(()=>document.querySelector('#wabk-panel').inert),true); await page.evaluate(()=>WAUI.setOpen(true)); assert.equal(await page.evaluate(()=>document.querySelector('#wabk-panel').inert),false); await page.evaluate(async()=>{
   let calls=0;
   WABridge.getActiveChat=async()=>{await new Promise(resolve=>setTimeout(resolve,30));return {id:'111111111@c.us',name:'test'};};
   WAExporter.exportChats=async()=>{calls++;return [{file:'test.zip',messages:1}];};
   await Promise.all([WAUI.startExport(true),WAUI.startExport(true)]);
   if(calls!==1)throw new Error('Duplicate export: '+calls);
   WABridge.getActiveChat=async()=>null;
   await WAUI.startExport(true);
   if(WAUI.state.busy)throw new Error('Export lock not released');
 }); assert.deepEqual(errors,[]); console.log('PASS: four tabs, recipient preview, stale preview prevention, XLSX XML/shared strings, privacy, backup integration. No real sends.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
