/* Local hover replies. Inserts a draft only; never sends a message. */
(function(g){
 'use strict';
 const defaults=[
   {title:'中文问候',text:'您好，感谢您的消息！请问有什么可以帮您？'},
   {title:'英文问候',text:'Hi! Thanks for your message. How can I help you?'},
   {title:'稍后回复',text:'Thank you for your message. I will get back to you shortly.'},
   {title:'询问需求',text:'Could you share more details about your requirements?'},
   {title:'发送报价',text:'Thank you for your inquiry. I will send you a quotation shortly.'},
   {title:'感谢',text:'Thank you! Please let me know if you have any further questions.'}
 ];
 let initialized=false,root,trigger,popover,manager,list,notice,target=null,signature='',timer,editing=-1,busy=false,observedMain=null,observer,fixedEntry;
 let settings={enabled:true,replies:defaults.map(x=>({...x}))};
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const status=text=>{notice.textContent=text;};
 const getEditor=()=>document.querySelector('#main footer [contenteditable="true"][role="textbox"]')||document.querySelector('#main footer [contenteditable="true"]')||document.querySelector('[data-testid="conversation-compose-box-input"][contenteditable="true"],[data-testid="conversation-compose-box-input"] [contenteditable="true"],footer [contenteditable="true"][role="textbox"]')||document.querySelector('#main [contenteditable="true"][data-tab="10"]')||document.querySelector('[contenteditable="true"][data-tab="10"][role="textbox"]');
 const chatRoot=()=>document.querySelector('#main')||getEditor()?.closest('[role="main"]')||getEditor()?.closest('section')||document.body;
 const headerKey=()=>chatRoot()?.querySelector('header,[data-testid="conversation-header"]')?.textContent||'';
 function validTarget(){const main=chatRoot();return !!(target?.isConnected&&main?.contains(target)&&headerKey()===signature);}
 function hide(){root.hidden=true;popover.hidden=true;target=null;trigger.setAttribute('aria-expanded','false');}
 function position(){
   if(!validTarget()){hide();return;}
   const anchor=target.querySelector('[data-testid="msg-container"]')||target.querySelector('.copyable-text')||target;
   const r=anchor.getBoundingClientRect();
   if(r.bottom<0||r.top>innerHeight||r.width===0){hide();return;}
   const left=Math.max(8,Math.min(r.right+8,innerWidth-110));root.style.left=left+'px';
   popover.style.left=Math.min(0,innerWidth-12-left-Math.min(310,innerWidth-24))+'px';
   root.style.top=Math.max(8,Math.min(r.top,innerHeight-(popover.hidden?38:Math.min(400,innerHeight-24))))+'px';
 }
 function show(message){
   clearTimeout(timer);target=message;signature=headerKey();root.hidden=false;position();
   const main=chatRoot();
   if(main!==observedMain){observer?.disconnect();observedMain=main;observer=new MutationObserver(()=>{if(!root.hidden&&!validTarget())hide();});if(main)observer.observe(main,{childList:true,subtree:true,characterData:true});}
 }
 function insert(text){
   if(!validTarget()){hide();return;}
   const input=getEditor();
   if(!input){status('未找到聊天输入框，请用“复制”后粘贴。');return;}
   if(input.getAttribute('aria-disabled')==='true'){status('聊天输入框不可用，请用“复制”。');return;}
   input.focus();const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(input);range.collapse(false);selection.removeAllRanges();selection.addRange(range);
   const prefix=input.textContent.trim()?'\n':'';
   // Editing through the browser keeps WhatsApp's editor state in sync.
   if(!document.execCommand('insertText',false,prefix+text)){status('当前输入框不支持自动填入，请用“复制”后粘贴。');return;}
   hide();
 }
 function render(){
   list.replaceChildren();
   for(const reply of settings.replies){
     const row=make('div',null,'waqr-reply');const choose=make('button',reply.title,'waqr-choice');choose.type='button';choose.title=reply.text;
     const summary=make('span',reply.text,'waqr-summary');choose.append(summary);choose.onclick=()=>insert(reply.text);
     const copy=make('button','复制','waqr-copy');copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(reply.text);status('已复制，请粘贴到输入框。');}catch{status('复制失败，可在管理中选中文字手动复制。');}};
     row.append(choose,copy);list.append(row);
   }
   if(!settings.replies.length)list.append(make('p','还没有回复语，点击管理添加。'));
 }
 async function save(next){
   if(busy)throw new Error('正在保存');busy=true;
   try{await chrome.storage.local.set({waaQuickReplies:next});settings=next;render();renderManager();if(!settings.enabled)hide();}finally{busy=false;}
 }
 function renderManager(){
   manager.querySelector('#waqr-enabled').checked=settings.enabled;
   const rows=manager.querySelector('.waqr-managed');rows.replaceChildren();
   settings.replies.forEach((r,i)=>{
     const row=make('div',null,'waqr-managed-row');row.append(make('span',r.title));
     const edit=make('button','编辑');edit.type='button';edit.onclick=()=>{editing=i;manager.querySelector('#waqr-title').value=r.title;manager.querySelector('#waqr-text').value=r.text;manager.querySelector('#waqr-title').focus();};
     const remove=make('button','删除');remove.type='button';remove.onclick=async()=>{try{const next={...settings,replies:settings.replies.filter((_,n)=>n!==i)};await save(next);clearForm();}catch(e){manager.querySelector('.waqr-manager-status').textContent=e.message;}};
     row.append(edit,remove);rows.append(row);
   });
 }
 function clearForm(){editing=-1;manager.querySelector('#waqr-title').value='';manager.querySelector('#waqr-text').value='';}
 function openManager(){init();hide();renderManager();manager.hidden=false;manager.querySelector('#waqr-title').focus();}
 function init(){
   if(initialized)return;initialized=true;
   root=make('div',null,'waqr-hover');root.id='waqr-hover';root.hidden=true;
   trigger=make('button','快捷回复','waqr-trigger');trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
   popover=make('div',null,'waqr-popover');popover.hidden=true;popover.setAttribute('role','dialog');popover.setAttribute('aria-label','快捷回复');
   list=make('div',null,'waqr-list');notice=make('div','点击回复语填入输入框，由你确认发送。','waqr-notice');notice.setAttribute('role','status');
   const manage=make('button','管理回复语','waqr-manage');manage.type='button';manage.onclick=openManager;
   popover.append(list,notice,manage);root.append(trigger,popover);document.body.append(root);
   fixedEntry=make('button','快捷回复','waqr-fixed-entry');fixedEntry.id='waqr-fixed-entry';fixedEntry.type='button';fixedEntry.title='选择常用回复语，填入当前聊天输入框';document.body.append(fixedEntry);
   const placeEntry=()=>{const editor=getEditor(),r=editor?.getBoundingClientRect();const panelOpen=!!WAUI.state?.open;fixedEntry.hidden=panelOpen||!!(editor&&(r.width===0||r.height===0));if(panelOpen)hide();fixedEntry.style.bottom=editor&&r.height?Math.max(16,innerHeight-r.top+8)+'px':'90px';};
   fixedEntry.onclick=()=>{const editor=getEditor();if(!editor){openManager();return;}show(editor);popover.hidden=false;trigger.setAttribute('aria-expanded','true');render();status('点击回复语填入输入框，由你确认发送。');position();};
   placeEntry();setInterval(placeEntry,1000);
   trigger.onclick=()=>{clearTimeout(timer);popover.hidden=!popover.hidden;trigger.setAttribute('aria-expanded',String(!popover.hidden));status('点击回复语填入输入框，由你确认发送。');render();position();};
   root.onpointerenter=()=>clearTimeout(timer);root.onpointerleave=()=>{if(popover.hidden)timer=setTimeout(hide,450);};
   manager=make('div',null,'waqr-manager');manager.id='waqr-manager';manager.hidden=true;manager.setAttribute('role','dialog');manager.setAttribute('aria-label','管理快捷回复');
   manager.innerHTML='<div class="waqr-manager-card"><div class="waqr-manager-header"><h3>管理快捷回复</h3><button type="button" class="waqr-close" aria-label="关闭快捷回复设置">×</button></div><label><input id="waqr-enabled" type="checkbox">鼠标移到对方消息旁时显示快捷回复</label><div class="waqr-managed"></div><label>名称<input id="waqr-title" maxlength="60" placeholder="例如：询问规格"></label><label>回复内容<textarea id="waqr-text" rows="4" maxlength="4000" placeholder="填写要插入聊天输入框的内容"></textarea></label><div class="waqr-manager-actions"><button type="button" id="waqr-save">保存回复语</button><button type="button" id="waqr-new">新增回复语</button></div><p class="waqr-manager-status" role="status">回复语保存在本机，不会自动发送。</p></div>';
   document.body.append(manager);manager.querySelector('.waqr-close').onclick=()=>{manager.hidden=true;};
   manager.onclick=e=>{if(e.target===manager)manager.hidden=true;};
   manager.querySelector('#waqr-new').onclick=clearForm;
   manager.querySelector('#waqr-enabled').onchange=async e=>{try{await save({...settings,enabled:e.target.checked});}catch(error){renderManager();manager.querySelector('.waqr-manager-status').textContent=error.message;}};
   manager.querySelector('#waqr-save').onclick=async()=>{
     const title=manager.querySelector('#waqr-title').value.trim(),text=manager.querySelector('#waqr-text').value.trim();
     const note=manager.querySelector('.waqr-manager-status');
     if(!title||!text){note.textContent='名称和回复内容都不能为空。';return;}
     if(editing<0&&settings.replies.length>=100){note.textContent='最多保存 100 条回复语。';return;}
     try{const replies=settings.replies.map(r=>({...r}));if(editing>=0)replies[editing]={title,text};else replies.push({title,text});await save({...settings,replies});clearForm();note.textContent='已保存。';}catch(e){note.textContent=e.message;}
   };
   document.addEventListener('pointerover',e=>{
     if(root.contains(e.target)||manager.contains(e.target)||e.target===fixedEntry)return;
     const node=e.target instanceof Element?e.target:null;
     const message=node?.closest('.message-in,[data-id^="false_"]');
     if(settings.enabled&&message&&!message.closest('.message-out')&&chatRoot()?.contains(message)){if(target!==message)popover.hidden=true;show(message);}
   });
   document.addEventListener('pointerout',e=>{if(target?.contains(e.target)&&!target.contains(e.relatedTarget)&&!root.contains(e.relatedTarget)&&popover.hidden)timer=setTimeout(hide,450);});
   document.addEventListener('click',e=>{if(e.target!==fixedEntry&&!root.contains(e.target)&&!target?.contains(e.target)&&!manager.contains(e.target))hide();});
   document.addEventListener('keydown',e=>{if(e.key==='Escape'){hide();manager.hidden=true;}});
   window.addEventListener('scroll',()=>{if(!root.hidden)position();},true);window.addEventListener('resize',()=>{if(!root.hidden)position();});
   chrome.storage.local.get('waaQuickReplies').then(data=>{const stored=data.waaQuickReplies;if(stored&&Array.isArray(stored.replies)){settings={enabled:stored.enabled!==false,replies:stored.replies.filter(r=>typeof r.title==='string'&&typeof r.text==='string').slice(0,100)};}render();}).catch(e=>status('读取回复语失败：'+e.message));
   chrome.storage.onChanged?.addListener((changes,area)=>{const value=changes.waaQuickReplies?.newValue;if(area==='local'&&value&&Array.isArray(value.replies)){settings={enabled:value.enabled!==false,replies:value.replies.filter(r=>typeof r.title==='string'&&typeof r.text==='string').slice(0,100)};render();if(!settings.enabled)hide();}});
 }
 g.WAQuickReplies={init,openManager};
 setTimeout(init,0);
 const originalBuild=WAUI.buildPanel;
 WAUI.buildPanel=function(){const panel=originalBuild.call(this);if(!panel.querySelector('.waqr-settings-entry')){const button=make('button','回复语设置','waqr-settings-entry');button.type='button';button.onclick=openManager;panel.querySelector('.waa-nav')?.append(button);}return panel;};
})(globalThis);
