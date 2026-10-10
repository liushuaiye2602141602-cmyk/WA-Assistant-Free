(function () {
  'use strict';
  const C = WAAssistantCore;
  let root, recipients = [], contacts = [], templates = [], report = [], files = [], account = '';
  let preview = null, queue = null, importing = false, starting = false, numbersDirty = false, currentJob=null, selectedJobId='', jobSelectionMade=false, refreshBusy=false, recorder=null, recordingStream=null, recordingPending=false;
  const $ = id => root.querySelector('#waa-' + id);
  const message = text => { $('status').textContent = text; };
  const fail = e => message(e.message || String(e));
  const action = (id, fn) => $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(fail));
  function download(name, rows) { WAExporter.downloadBlob(new Blob([C.csv(rows)], { type: 'text/csv;charset=utf-8' }), name); }
  function invalidate() {
    const hadPreview = !!preview;
    preview = null; $('start').disabled = true;
    $('preview').textContent = '';
    if (hadPreview) message('内容或设置已修改，请重新生成发送预览。');
  }
  function setRecipients(rows) {
    if (starting) throw new Error('请等待任务保存');
    recipients = C.dedupeContacts(rows);
    numbersDirty = false;
    const summary = $('recipient-summary');
    if (summary) summary.textContent = recipients.slice(0, 12).map(r => `${r.name || r.phone || r.id} · ${r.id}`).join('\n') + (recipients.length > 12 ? `\n另有 ${recipients.length - 12} 位，可在发送预览中核对` : '');
    $('count').textContent = recipients.length + ' 位收件人'; invalidate();
  }
  async function connected() {
    if (!(await WABridge.waitReady())) throw new Error('请登录 WhatsApp Web，刷新后重试');
    account = await WABridge.call('assistantAccount');
    if (!account) throw new Error('无法识别当前账号，暂不能执行发送操作');
    return account;
  }
  async function persist() {
    await chrome.storage.local.set({ waaTemplates: templates });
  }
  function renderReport(q) {
    report = q.items; const counts = {};
    for (const r of report) counts[r.status] = (counts[r.status] || 0) + 1;
    const delivered=report.filter(r=>C.delivery(r)==='delivered'||C.delivery(r)==='read').length,read=report.filter(r=>C.delivery(r)==='read').length;
    $('stats').textContent = `总数 ${report.length} · 已提交 ${counts.submitted || 0} · 全部消息送达 ${delivered} · 全部消息已读 ${read} · 失败 ${counts.failed || 0} · 不确定 ${counts.uncertain||0} · 退订跳过 ${counts.optedout||0} · 等待 ${counts.pending || 0}${q.paused ? ' · 已暂停' : ''}`;
    $('pause').disabled = $('stop').disabled = !currentJob || ['completed','stopped'].includes(currentJob.status);
    $('pause').textContent = q.paused ? '继续' : '暂停';
    $('retry').disabled = q.running || !report.some(r => r.status === 'failed');
    $('resume').disabled=!currentJob||!['paused','waiting','attention'].includes(currentJob.status);
    $('start').disabled = starting || !preview;
    $('report').textContent = report.map(r => `${r.recipient.name || r.recipient.id} — ${{ pending: '等待', sending: '发送中', submitted: '已提交', failed: '失败',uncertain:'结果不确定，请核对',optedout:'已退订，跳过' }[r.status]}${r.status==='submitted'?' · '+({read:'全部消息已读',delivered:'全部消息已送达',submitted:'等待回执',unknown:'回执未知'}[C.delivery(r)]):''}${r.time?' · '+new Date(r.time).toLocaleString():''}${r.error ? ': ' + r.error : ''}${r.deleteError?' · '+r.deleteError:''}`).join('\n');
  }
  async function refreshJobs() {
    if(refreshBusy)return;refreshBusy=true;
    try {
      const state=await WAJobClient.state(); const selector=$('jobs');
      if(!jobSelectionMade&&!selectedJobId&&state.jobs.length)selectedJobId=state.jobs[state.jobs.length-1].id;
      selector.replaceChildren(new Option('选择任务',''));
      for(const j of state.jobs)selector.append(new Option(`${new Date(j.createdAt).toLocaleString()} · ${j.items.length} 位 · ${{queued:'排队/定时',running:'运行',waiting:'等待连接',paused:'暂停',attention:'需要核对',completed:'完成',stopped:'停止'}[j.status]||j.status}`,j.id));
      selector.value=selectedJobId;
      currentJob=state.jobs.find(j=>j.id===selectedJobId)||null;
      if(currentJob){queue={items:currentJob.items,running:['queued','running','waiting'].includes(currentJob.status),paused:currentJob.status==='paused'};renderReport(queue);}
      else {
        queue=null; report=[]; $('report').textContent='';
        $('stats').textContent=state.jobs.length?'请选择任务查看发送结果':'尚无发送任务';
        for(const id of ['pause','stop','retry','resume']) $(id).disabled=true;
      }
      $('report-export').disabled=$('receipts-refresh').disabled=!currentJob;
      $('suppression').replaceChildren();
      const currentAccount=account||currentJob?.account;
      for(const [id,entry]of Object.entries(state.suppression[currentAccount]||{})){
        const line=document.createElement('div');line.textContent=`${id} · ${new Date(entry.at).toLocaleString()} `;
        const restore=document.createElement('button');restore.textContent='允许再次联系';restore.onclick=()=>WAJobClient.rpc({type:'WAA_UNSUPPRESS',account:currentAccount,id}).then(()=>WAJobClient.refreshMonitor()).then(refreshJobs).catch(fail);line.append(restore);$('suppression').append(line);
      }
    }finally{refreshBusy=false;}
  }
  function prepare() {
    if (importing || recordingPending || recorder?.state==='recording') throw new Error('请等待附件或录音完成');
    if (!recipients.length) throw new Error('请先添加收件人');
    if (numbersDirty) throw new Error('号码已修改，请先点击读取号码');
    const text = $('text').value;
    if (!text.trim() && !files.length) throw new Error('请输入消息或添加附件');
    const optout = $('optout').checked ? '\n如果不希望收到此类消息，请回复“退订”。' : '';
    const buttons=C.parseButtons($('buttons').value);
    if(buttons.length&&!text.trim())throw new Error('按钮消息需要文本内容');
    preview = recipients.map(recipient => ({ recipient: { ...recipient }, text: C.personalize(text, recipient) + optout, files: files.slice() }));
    $('preview').textContent = preview.slice(0, 20).map(r => `${r.recipient.name || r.recipient.id} (${r.recipient.id})\n${r.text}\n附件：${r.files.map(f => f.name).join('、') || '无'}\n按钮：${buttons.map(b=>b.text).join('、')||'无'}${$('timestamp').checked?'\n发送时将追加实际时间':''}`).join('\n\n') + (preview.length > 20 ? `\n…其余 ${preview.length - 20} 位` : '');
    $('start').disabled = false;
    message(`预览已生成：${preview.length} 位收件人。核对后点击开始发送。`);
  }
  async function run(items) {
    if (starting) throw new Error('正在创建任务');
    if (!$('consent').checked) throw new Error('请确认收件人同意接收消息');
    const min = Number($('min').value) * 1000, max = Number($('max').value) * 1000;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1000 || max < min) throw new Error('发送间隔设置无效');
    const scheduled = $('schedule').value;
    const scheduledAt=scheduled?new Date(scheduled).getTime():Date.now();
    if(!Number.isFinite(scheduledAt)||(scheduled&&scheduledAt<=Date.now()))throw new Error('请选择未来的定时时间');
    const deleteMode=$('delete-mode').value, deleteConfirmed=$('delete-confirm').checked;
    if(deleteMode!=='none'&&!deleteConfirmed)throw new Error('请勾选确认删除范围，建议先备份');
    const timestamp=$('timestamp').checked, buttons=C.parseButtons($('buttons').value);
    starting = true; $('start').disabled = true;
    try {
      const startAccount=await connected();
      const result=await WAJobClient.rpc({type:'WAA_CREATE',payload:{account:startAccount,consent:true,items:items.map(r=>({recipient:r.recipient,text:r.text})),files:items[0]?.files||[],minMs:min,maxMs:max,scheduledAt,timestamp,buttons,deleteMode,deleteConfirmed}});
      selectedJobId=result.job.id;preview=null;await refreshJobs();
      message(scheduled?'定时任务已保存。浏览器运行时自动执行；关闭 WhatsApp 标签页会重新打开。':'任务已交给后台执行；关闭面板不影响任务。');
    }finally{starting=false;$('start').disabled=!preview;}
  }
  async function loadContacts() {
    await connected();
    const source = $('source').value;
    if (source === 'chats') contacts = (await WABridge.getChatList()).filter(c => !c.id.endsWith('@g.us'));
    else if (source === 'group') {
      const ids=Array.from($('group').selectedOptions).map(o=>o.value).filter(Boolean);if(!ids.length)throw new Error('请选择一个或多个群组');
      contacts=[];
      for(let n=0;n<ids.length;n++){message(`读取群成员 ${n+1}/${ids.length}…`);contacts.push(...await WABridge.call('assistantGroup',{id:ids[n],excludeAdmins:$('admins').checked},120000));}
    }
    else contacts = await WABridge.call('assistantContacts', { filter: source, label: $('label').value.trim() }, 60000);
    const originalCount=contacts.length;
    contacts=C.dedupeContacts(contacts);
    $('contacts').replaceChildren();
    for (const c of contacts) {
      const label = document.createElement('label'); const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = true; input.dataset.id = c.id;
      label.append(input, document.createTextNode(`${c.name || '未命名'} · ${c.phone || c.id}${c.admin ? ' · 管理员' : ''}`));
      $('contacts').append(label);
    }
    message(`读取 ${contacts.length} 位联系人${originalCount>contacts.length?`，已合并 ${originalCount-contacts.length} 条重复记录`:''}`);
  }
  function chosenContacts() {
    const ids = new Set(Array.from($('contacts').querySelectorAll('input:checked')).map(x => x.dataset.id));
    return contacts.filter(c => ids.has(c.id));
  }
  function renderTemplates() {
    $('templates').replaceChildren(new Option('选择已保存模板', ''));
    templates.forEach((t, i) => $('templates').append(new Option(t.name, String(i))));
  }
  function mount(panel) {
    if (panel.querySelector('.waa-nav')) return;
    root = panel;
    panel.querySelector('.wabk-brand').textContent = 'WhatsApp 助手';
    panel.querySelector('.wabk-badge').textContent = '免费本地版';
    const backup = document.createElement('div'); backup.dataset.pane = 'backup'; backup.className = 'waa-pane';
    for (const node of Array.from(panel.children)) if (!node.classList.contains('wabk-header')) backup.append(node);
    panel.append(backup);
    const nav = document.createElement('nav'); nav.className = 'waa-nav';
    for (const [key, label] of [['backup', '聊天备份'], ['send', '批量发送'], ['contacts', '联系人'], ['privacy', '隐私保护']]) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.tab = key; b.classList.toggle('active', key === 'backup');
      b.onclick = () => { panel.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== key); nav.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); }; nav.append(b);
    }
    panel.querySelector('.wabk-header').after(nav);
    const tools = document.createElement('div'); tools.className = 'waa-tools';
    tools.innerHTML = `
      <section data-pane="send" class="waa-pane" hidden>
        <h3>批量发送</h3><p>输入含国家区号的完整号码，或导入 CSV / Excel（.xlsx）。支持 {{name}}、{{phone}} 和表头字段。</p>
        <textarea id="waa-numbers" rows="3" placeholder="8613800000000, 84900000000"></textarea>
        <div class="waa-row"><button id="waa-add">读取号码</button><label class="waa-file">导入 CSV / XLSX<input id="waa-import" type="file" accept=".csv,.xlsx"></label><button id="waa-template-file">下载导入模板</button><span id="waa-count">0 位收件人</span></div>
        <pre id="waa-recipient-summary" aria-label="已添加的收件人"></pre>
        <div class="waa-row"><select id="waa-templates"></select><button id="waa-load-template">使用模板</button><button id="waa-save-template">保存模板</button><button id="waa-delete-template">删除模板</button></div>
        <input id="waa-template-name" placeholder="模板名称"><textarea id="waa-text" rows="5" placeholder="你好 {{name}}，这是我们的产品信息。"></textarea>
        <label class="waa-file">添加图片、视频、音频或文档（单个 ≤ 16 MB，总计 ≤ 32 MB）<input id="waa-files" type="file" multiple></label><div id="waa-files-list"></div>
        <div class="waa-row"><label>间隔最小（秒）<input id="waa-min" type="number" value="5" min="1"></label><label>最大（秒）<input id="waa-max" type="number" value="10" min="1"></label></div>
        <div class="waa-row"><button id="waa-record">开始录音</button><button id="waa-record-stop" disabled>结束录音</button><button id="waa-files-clear">清空附件</button></div><audio id="waa-record-preview" controls hidden></audio>
        <label>按钮消息（最多 3 行）：文字 | url/phone/reply/copy | 内容<textarea id="waa-buttons" rows="3" placeholder="查看产品 | url | https://example.com"></textarea></label><p>按钮依赖 WhatsApp 的兼容支持；回复按钮不能与网址或电话按钮混用。接口不支持时会显示失败，不会悄悄改成普通消息。</p>
        <label>定时发送（留空立即执行）<input id="waa-schedule" type="datetime-local"></label><p>使用本机时间。浏览器需要保持运行；休眠或退出后，将在恢复运行并连接账号后执行。</p>
        <label>发送后删除<select id="waa-delete-mode"><option value="none">保留消息与聊天</option><option value="messages">仅删除本次发送的消息（从自己的设备删除）</option><option value="chat">删除整个聊天（包含已有历史）</option></select></label><label><input id="waa-delete-confirm" type="checkbox">我确认所选删除范围，已备份需要保留的内容</label><p>删除不是撤回，对方仍可看到消息。删除后的历史可能无法恢复；群组不支持时会报告删除失败。</p>
        <label><input id="waa-optout" type="checkbox">追加退订提示</label><label><input id="waa-consent" type="checkbox">收件人已同意接收这些消息</label>
        <div class="waa-row"><button id="waa-preview-btn">生成发送预览</button><button id="waa-start" disabled>开始发送</button><button id="waa-pause" disabled>暂停</button><button id="waa-stop" disabled>停止</button></div>
        <pre id="waa-preview" class="waa-preview"></pre><h3>任务与发送报告</h3><select id="waa-jobs"></select><div class="waa-row"><button id="waa-jobs-refresh">刷新任务</button><button id="waa-resume">恢复所选任务</button><button id="waa-receipts-refresh">查询送达 / 已读</button></div><div id="waa-stats">尚无发送任务</div><pre id="waa-report"></pre>
        <div class="waa-row"><button id="waa-retry" disabled>预览失败项重试</button><button id="waa-report-export">导出报告 CSV</button></div>
        <p>关闭页面后由后台保存和继续调度。正在发送的一项如果中断，会标为不确定并暂停；核对后可恢复其余未发送项，不会自动重发不确定项。</p>
      </section>
      <section data-pane="contacts" class="waa-pane" hidden>
        <h3>联系人管理</h3><div class="waa-row"><select id="waa-source"><option value="chats">聊天联系人</option><option value="all">所有联系人</option><option value="saved">已保存联系人</option><option value="unsaved">未保存联系人</option><option value="group">群成员</option></select><button id="waa-groups-refresh">刷新群列表</button></div>
        <select id="waa-group"><option value="">请选择群组</option></select><label><input id="waa-admins" type="checkbox">导出群成员时排除管理员</label>
        <input id="waa-label" placeholder="可选：WhatsApp Business 标签名称或 ID（联系人来源适用）">
        <div class="waa-row"><button id="waa-contacts-load">读取联系人</button><button id="waa-select-all">全选</button><button id="waa-select-none">清空选择</button></div>
        <div id="waa-contacts" class="waa-contact-list"></div><div class="waa-row"><button id="waa-contacts-send">选中联系人作为收件人</button><button id="waa-contacts-export">导出选中 CSV</button><button id="waa-groups-send">所选群作为收件人</button><button id="waa-check">检查收件人号码</button></div>
        <label>活跃度观察窗口（天）<input id="waa-activity-days" type="number" min="1" max="365" value="30"></label><button id="waa-activity">查询最近可见活动</button><button id="waa-activity-export">导出活动报告</button><pre id="waa-check-report"></pre><p>最近活动依据可见的上线时间和收到的消息；隐藏上线时间或没有可见记录时显示未知，不等于不活跃。部分隐私 ID 无法解析成真实手机号。</p>
        <h3>自动退订</h3><label><input id="waa-auto-optout" type="checkbox" checked>监听退订并在后续发送中自动排除</label><label>退订关键词（每行一个，完整匹配）<textarea id="waa-keywords" rows="3">退订\n取消订阅\nstop\nunsubscribe\n不要再发</textarea></label><button id="waa-optout-save">保存退订设置</button><div id="waa-suppression"></div><p>仅处理个人聊天的收到消息。启动发送前补查最近 30 条消息；仅凭旧历史不保证找回所有离线期间的退订。</p>
      </section>
      <section data-pane="privacy" class="waa-pane" hidden><h3>屏幕隐私保护</h3><p>移开鼠标时模糊内容，悬停可临时查看。只影响当前页面显示。</p>
        <label><input type="checkbox" data-privacy="messages">聊天消息</label><label><input type="checkbox" data-privacy="previews">列表消息预览</label><label><input type="checkbox" data-privacy="names">联系人和群名称</label><label><input type="checkbox" data-privacy="photos">头像</label><label><input type="checkbox" data-privacy="media">图片和视频</label><label><input type="checkbox" data-privacy="input">输入框</label>
      </section><div id="waa-status" role="status" aria-live="polite">本地工具就绪</div>`;
    panel.append(tools);
    action('add', () => { setRecipients(C.recipients($('numbers').value.split(/[,;\n]+/).filter(x => x.trim()).map(x => [x.trim()]))); message('号码已读取'); });
    $('import').onchange = async () => {
      importing = true; invalidate();
      try { const f = $('import').files[0]; if (f) { const rows = /\.xlsx$/i.test(f.name) ? await WAReadXlsx(f) : C.parseCSV(await f.text()); setRecipients(C.recipients(rows)); $('numbers').value=''; message(`已导入 ${recipients.length} 位收件人`); } } catch (e) { fail(e); } finally { importing = false; $('import').value = ''; }
    };
    action('template-file', async () => WAExporter.downloadBlob(await WAWriteXlsx([['phone', 'name', 'company'], ['8613800000000', '张先生', '示例公司']]), '联系人导入模板.xlsx'));
    action('preview-btn', prepare);
    action('start', () => { if (!preview) throw new Error('请先生成预览'); return run(preview); });
    async function command(command){if(!currentJob)throw new Error('请选择任务');await WAJobClient.rpc({type:'WAA_COMMAND',jobId:currentJob.id,command});await refreshJobs();message(command==='stop'?'任务已停止，正在提交的单条消息不能撤回。':'任务状态已更新');}
    action('pause', () => command(currentJob?.status==='paused'?'resume':'pause')); action('stop', () => command('stop')); action('resume',()=>command('resume'));
    action('jobs-refresh',refreshJobs);$('jobs').onchange=()=>{jobSelectionMade=true;selectedJobId=$('jobs').value;refreshJobs().catch(fail);};
    action('retry', () => {
      if(currentJob?.items.some(r=>r.status==='sending'))throw new Error('请等待当前发送完成');
      preview = report.filter(r => r.status === 'failed').map(r => ({ recipient: r.recipient, text: r.text, files: currentJob?.files || [] })); if (!preview.length) throw new Error('没有可安全重试的失败项');
      $('buttons').value=(currentJob?.settings.buttons||[]).map(b=>[b.text,b.url?'url':b.phoneNumber?'phone':b.id?'reply':'copy',b.url||b.phoneNumber||b.id||b.code].join(' | ')).join('\n');
      $('timestamp').checked=!!currentJob?.settings.timestamp;$('delete-mode').value=currentJob?.settings.deleteMode||'none';$('delete-confirm').checked=false;$('schedule').value='';
      $('preview').textContent = preview.map(r => r.recipient.id + '\n' + r.text).join('\n\n'); $('start').disabled = false; message('失败项已准备，请核对后点击开始发送。不确定或部分提交项不会自动重试。');
    });
    action('report-export', () => download('发送报告.csv', [['name', 'id', 'status', 'delivery', 'error','deleteError', 'time','messageIds'], ...report.map(r => [r.recipient.name, r.recipient.id, r.status,C.delivery(r), r.error,r.deleteError, r.time,(r.messageIds||[]).join(';')])]));
    action('receipts-refresh',async()=>{
      await connected();if(currentJob?.account!==account)throw new Error('请登录任务绑定的账号');
      const ids=report.flatMap(r=>r.messageIds||[]);let unknown=0;
      for(let n=0;n<ids.length;n+=20)for(const receipt of await WABridge.call('assistantReceipts',{ids:ids.slice(n,n+20)},60000)){if(receipt.unknown)unknown++;else await WAJobClient.rpc({type:'WAA_RECEIPT',account,id:receipt.id,ack:receipt.ack,groupVerified:receipt.groupVerified});}
      await refreshJobs();message(`回执已更新${unknown?'；'+unknown+' 条无法查询（已删除或接口不可见）':''}`);
    });
    $('files').onchange = async () => {
      importing = true; invalidate(); files = [];
      try {
        const selected = Array.from($('files').files); if (selected.some(f => f.size > 16 * 1024 * 1024) || selected.reduce((s, f) => s + f.size, 0) > 32 * 1024 * 1024) throw new Error('附件超过大小限制');
        files = await Promise.all(selected.map(f => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('附件读取失败')); reader.onload = () => resolve({ name: f.name, mime: f.type || 'application/octet-stream', data: reader.result }); reader.readAsDataURL(f); })));
        $('files-list').textContent = selected.map(f => f.name).join('、');
      } catch(e) { $('files').value = ''; $('files-list').textContent = ''; fail(e); } finally { importing = false; }
    };
    $('text').oninput = invalidate; $('optout').onchange = invalidate; $('numbers').oninput = () => { numbersDirty = true; invalidate(); message('号码已修改，请点击读取号码更新收件人'); };
    const timeLabel = document.createElement('label'); const timeInput = document.createElement('input');
    timeInput.type = 'checkbox'; timeInput.id = 'waa-timestamp'; timeInput.onchange = invalidate; timeLabel.append(timeInput, document.createTextNode('发送时追加实际时间')); $('optout').parentElement.after(timeLabel);
    for(const id of ['buttons','schedule','delete-mode','delete-confirm','min','max']){$(id).addEventListener('input',invalidate);$(id).addEventListener('change',invalidate);}
    let recordTimer,recordUrl;
    const renderFiles=()=>{$('files-list').textContent=files.map(f=>f.name).join('、');};
    action('files-clear',()=>{files=[];$('files').value='';if(recordUrl)URL.revokeObjectURL(recordUrl);recordUrl=null;$('record-preview').removeAttribute('src');$('record-preview').hidden=true;renderFiles();invalidate();});
    action('record',async()=>{
      if(recordingPending||recorder?.state==='recording')throw new Error('正在录音');
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器不支持录音');
      recordingPending=true;$('record').disabled=true;
      try{
        recordingStream=await navigator.mediaDevices.getUserMedia({audio:true});
        const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
        recorder=new MediaRecorder(recordingStream,mime?{mimeType:mime}:{});const chunks=[];let bytes=0;
        recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>16*1024*1024&&recorder.state==='recording')recorder.stop();}};
        recorder.onstop=async()=>{
          clearTimeout(recordTimer);recordingStream?.getTracks().forEach(t=>t.stop());$('record-stop').disabled=true;importing=true;
          try{
            const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
            const existingSize=files.reduce((s,f)=>s+Math.ceil((f.data.split(',')[1]?.length||0)*3/4),0);
            if(blob.size>16*1024*1024||existingSize+blob.size>32*1024*1024)throw new Error('录音超过附件大小限制');
            const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('录音读取失败'));r.readAsDataURL(blob);});
            files.push({name:`录音_${Date.now()}.${blob.type.includes('ogg')?'ogg':'webm'}`,mime:blob.type,data,isPtt:true});
            if(recordUrl)URL.revokeObjectURL(recordUrl);recordUrl=URL.createObjectURL(blob);$('record-preview').src=recordUrl;$('record-preview').hidden=false;renderFiles();invalidate();message('录音已加入附件，可先试听后生成发送预览');
          }catch(e){fail(e);}finally{importing=false;$('record').disabled=false;recordingPending=false;}
        };
        recorder.onerror=e=>{fail(e.error||new Error('录音失败'));if(recorder.state==='recording')recorder.stop();};
        recorder.start(1000);$('record-stop').disabled=false;invalidate();message('正在录音，最长两分钟；点击结束录音保存');recordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},120000);
      }catch(e){recordingStream?.getTracks().forEach(t=>t.stop());$('record').disabled=false;recordingPending=false;throw e;}
    });
    action('record-stop',()=>{if(recorder?.state==='recording')recorder.stop();});
    action('save-template', async () => { const name = $('template-name').value.trim(); if (!name) throw new Error('请输入模板名称'); const t = { name, text: $('text').value }; const i = templates.findIndex(x => x.name === name); if (i < 0) templates.push(t); else templates[i] = t; await persist(); renderTemplates(); message('模板已保存'); });
    action('load-template', () => { const t = templates[$('templates').value]; if (!t) throw new Error('请选择模板'); $('text').value = t.text; $('template-name').value = t.name; invalidate(); });
    action('delete-template', async () => { const i = $('templates').value; if (i === '') throw new Error('请选择模板'); templates.splice(Number(i), 1); await persist(); renderTemplates(); });
    action('groups-refresh', async () => { await connected(); const groups = (await WABridge.getChatList()).filter(c => c.id.endsWith('@g.us')); $('group').replaceChildren(new Option('请选择群组', '')); groups.forEach(c => $('group').append(new Option(c.name, c.id))); message(`读取 ${groups.length} 个群组`); });
    action('contacts-load', loadContacts);
    action('select-all', () => $('contacts').querySelectorAll('input').forEach(x => x.checked = true));
    action('select-none', () => $('contacts').querySelectorAll('input').forEach(x => x.checked = false));
    action('contacts-send', () => { const selected=chosenContacts(); if(!selected.length)throw new Error('请先选择联系人'); setRecipients(selected.map(c => ({ ...c, phone: c.phone || c.id.split('@')[0] }))); $('numbers').value=''; nav.querySelector('[data-tab="send"]').click(); message(`已添加 ${recipients.length} 位联系人，请在收件人列表中核对。`); });
    action('contacts-export', () => download('联系人.csv', [['id', 'phone', 'name', 'saved', 'admin'], ...chosenContacts().map(c => [c.id, c.phone, c.name, c.saved, c.admin])]));
    const excelButton = document.createElement('button'); excelButton.textContent = '导出选中 Excel';
    excelButton.onclick = () => WAWriteXlsx([['phone', 'name', 'id', 'saved', 'admin'], ...chosenContacts().map(c => [c.phone || c.id, c.name, c.id, c.saved, c.admin])]).then(blob => WAExporter.downloadBlob(blob, '联系人.xlsx')).catch(fail);
    $('contacts-export').after(excelButton);
    $('group').multiple = true; $('group').size = 4;
    action('groups-send', () => { const options = Array.from($('group').selectedOptions).filter(o=>o.value); if (!options.length) throw new Error('请选择群组（可按 Ctrl 多选）'); setRecipients(options.map(o=>({ id:o.value, name:o.text, phone:o.value.split('@')[0] }))); $('numbers').value=''; nav.querySelector('[data-tab="send"]').click(); });
    action('check', async () => { await connected(); if (!recipients.length) throw new Error('请先添加收件人'); const results = []; for (const r of recipients) { try { const checked = await WABridge.call('assistantCheck', { id: r.id }); results.push(`${r.id}: ${checked.exists ? '已注册' : '未查询到'}`); } catch(e) { results.push(`${r.id}: ${e.message}`); } $('check-report').textContent = results.join('\n'); } });
    let activityReport=[];
    action('activity',async()=>{
      await connected();if(!recipients.length)throw new Error('请先添加收件人');
      const days=Number($('activity-days').value);if(!Number.isInteger(days)||days<1||days>365)throw new Error('观察窗口需为 1–365 天');
      activityReport=[];
      for(let n=0;n<recipients.length;n++){
        const r=recipients[n];message(`查询最近活动 ${n+1}/${recipients.length}`);
        try{const activity=await WABridge.call('assistantActivity',{id:r.id,days},30000);activityReport.push({id:r.id,name:r.name,...activity});}
        catch(e){activityReport.push({id:r.id,name:r.name,activity:'unknown',error:e.message});}
        $('check-report').textContent=activityReport.map(x=>`${x.name||x.id}: ${x.exists===false?'未查询到注册':x.activity==='recent'?`近 ${days} 天有可见活动`:'活跃度未知'}${x.lastSeen?' · 最近上线 '+new Date(x.lastSeen).toLocaleString():''}${x.lastInbound?' · 最近收到消息 '+new Date(x.lastInbound).toLocaleString():''}${x.error?' · '+x.error:''}`).join('\n');
      }
      message('活动查询完成；未知不代表不活跃');
    });
    action('activity-export',()=>download('号码活动报告.csv',[['id','name','registered','activity','lastSeen','lastInbound','error'],...activityReport.map(x=>[x.id,x.name,x.exists,x.activity,x.lastSeen?new Date(x.lastSeen).toISOString():'',x.lastInbound?new Date(x.lastInbound).toISOString():'',x.error])]));
    action('optout-save',async()=>{
      const keywords=$('keywords').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      await WAJobClient.rpc({type:'WAA_SETTINGS',autoOptout:$('auto-optout').checked,keywords});await WAJobClient.refreshMonitor();message('退订设置已保存');
    });
    const privacy = panel.querySelectorAll('[data-privacy]');
    privacy.forEach(cb => cb.onchange = async () => { document.documentElement.classList.toggle('waa-blur-' + cb.dataset.privacy, cb.checked); const settings = Object.fromEntries(Array.from(privacy).map(x => [x.dataset.privacy, x.checked])); try { await chrome.storage.local.set({ waaPrivacy: settings }); } catch(e) { fail(e); } });
    chrome.storage.local.get(['waaTemplates', 'waaPrivacy', 'waaReport']).then(data => {
      templates = Array.isArray(data.waaTemplates) ? data.waaTemplates : []; renderTemplates();
      for (const cb of privacy) { cb.checked = !!data.waaPrivacy?.[cb.dataset.privacy]; document.documentElement.classList.toggle('waa-blur-' + cb.dataset.privacy, cb.checked); }
    }).catch(fail);
    WAJobClient.rpc({type:'WAA_CONFIG'}).then(data=>{$('auto-optout').checked=data.settings.autoOptout!==false;$('keywords').value=data.settings.keywords.join('\n');}).catch(fail);
    refreshJobs().catch(fail);
    setInterval(()=>{if(WAUI.state.open)refreshJobs().catch(fail);},2000);
  }
  const original = WAUI.buildPanel;
  WAUI.buildPanel = function () { const panel = original.call(this); mount(panel); return panel; };
  window.addEventListener('beforeunload', e => { if (recorder?.state==='recording') { e.preventDefault(); e.returnValue = ''; } });
})();
