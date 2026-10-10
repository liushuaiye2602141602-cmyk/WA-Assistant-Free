/* Independently implemented local tools. No Easy Sender code or services. */
(function (g) {
  'use strict';
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (c === ',' && !quoted) { row.push(value); value = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(x => x.trim())) rows.push(row); row = []; value = ''; }
      else value += c;
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    row.push(value); if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }
  function csv(rows) {
    return '\uFEFF' + rows.map(r => r.map(v => {
      let s = String(v ?? '');
      // Prevent spreadsheet formula execution when reports are opened in Excel.
      if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  function target(value) {
    const s = String(value || '').trim();
    if (/^[\d-]+@g\.us$/.test(s) || /^\d+@lid$/.test(s)) return s;
    if (/^\d+@c\.us$/.test(s)) return s;
    if (!/^[+\d\s().-]+$/.test(s)) throw new Error('号码格式错误：' + s);
    const digits = s.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Error('请使用含国家区号的完整号码：' + s);
    return digits + '@c.us';
  }
  function recipients(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(x => String(x).trim());
    const hasHeader = /^(phone|number|whatsapp|号码|手机号|电话|id)$/i.test(header[0]);
    const keys = hasHeader ? header : ['phone', 'name'];
    const result = []; const seen = new Set();
    for (const r of rows.slice(hasHeader ? 1 : 0)) {
      if (!r[0]?.trim()) continue;
      const id = target(r[0]); if (seen.has(id)) continue; seen.add(id);
      const fields = Object.create(null);
      r.forEach((v, i) => { fields[keys[i] || 'field' + (i + 1)] = String(v); });
      fields.phone = id.split('@')[0]; fields.name = fields.name || fields['姓名'] || r[1] || fields.phone;
      result.push({ ...fields, id });
    }
    return result;
  }
  function dedupeContacts(rows) {
    const parent=rows.map((_,i)=>i), seen=new Map();
    const find=i=>{let root=i;while(parent[root]!==root)root=parent[root];while(parent[i]!==i){const next=parent[i];parent[i]=root;i=next;}return root;};
    const phoneOf=row=>{
      if(/@g\.us$/.test(String(row.id||'')))return '';
      const phone=String(row.phone||'').replace(/\D/g,'');
      if(phone.length>=7&&phone.length<=15)return phone;
      const match=String(row.id||'').match(/^(\d{7,15})@c\.us$/);
      return match?match[1]:''; // A LID is an internal identifier, never a phone number.
    };
    rows.forEach((row,i)=>{
      const keys=row.id?['id:'+row.id]:[]; const phone=phoneOf(row);
      if(phone)keys.push('phone:'+phone);
      keys.forEach(key=>{if(seen.has(key))parent[find(i)]=find(seen.get(key));else seen.set(key,i);});
    });
    const groups=new Map();
    rows.forEach((row,i)=>{
      const key=find(i), previous=groups.get(key), phone=phoneOf(row);
      if(!previous){groups.set(key,{...row,phone});return;}
      if(!previous.phone&&phone)previous.phone=phone;
      if(/@c\.us$/.test(row.id)&&!/@c\.us$/.test(previous.id))previous.id=row.id;
      if(row.name&&(!previous.name||(row.saved&&!previous.saved)))previous.name=row.name;
      previous.saved=!!(previous.saved||row.saved);
      previous.admin=!!(previous.admin||row.admin);
    });
    return [...groups.values()];
  }
  function personalize(template, row) {
    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key) => {
      if (!Object.hasOwn(row, key)) throw new Error('缺少占位符字段：' + key);
      return String(row[key]);
    });
  }
  class Queue {
    constructor(send, onChange = () => {}, wait = ms => new Promise(r => setTimeout(r, ms))) {
      this.send = send; this.onChange = onChange; this.wait = wait;
      this.running = false; this.paused = false; this.stopped = false; this.items = [];
    }
    async run(items, minMs, maxMs) {
      if (this.running) throw new Error('已有发送任务');
      if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs < 1000 || maxMs < minMs) throw new Error('间隔至少 1 秒，最大值不能小于最小值');
      this.running = true; this.paused = false; this.stopped = false;
      this.items = items.map(x => ({ ...x, status: 'pending', error: '' }));
      try {
        for (let i = 0; i < this.items.length; i++) {
          while (this.paused && !this.stopped) await this.wait(200);
          if (this.stopped) break;
          const item = this.items[i]; item.status = 'sending'; this.onChange(this);
          try { await this.send(item); item.status = 'submitted'; }
          catch (e) { item.status = 'failed'; item.error = String(e.message || e); }
          item.time = new Date().toISOString(); this.onChange(this);
          if (i < this.items.length - 1) {
            let remaining = minMs + Math.random() * (maxMs - minMs);
            while (remaining > 0 && !this.stopped) {
              while (this.paused && !this.stopped) await this.wait(200);
              const step = Math.min(200, remaining); await this.wait(step); remaining -= step;
            }
          }
        }
      } finally { this.running = false; this.onChange(this); }
      return this.items;
    }
    pause() { this.paused = !this.paused; this.onChange(this); }
    stop() { this.stopped = true; this.paused = false; this.onChange(this); }
  }
  function parseButtons(value) {
    const lines=String(value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(lines.length>3)throw new Error('最多三个按钮');
    const buttons=lines.map((line,n)=>{
      const [text,type,...parts]=line.split('|').map(x=>x.trim());const value=parts.join('|');
      if(!text||!value)throw new Error('按钮格式：文字 | url/phone/reply/copy | 内容');
      if(type==='url'){let url;try{url=new URL(value);}catch{throw new Error('按钮网址无效');}if(!['https:','http:'].includes(url.protocol))throw new Error('按钮网址需使用 http/https');return {text,url:url.href};}
      if(type==='phone')return {text,phoneNumber:target(value).split('@')[0]};
      if(type==='reply')return {text,id:value||String(n)};
      if(type==='copy')return {text,code:value};
      throw new Error('未知按钮类型：'+type);
    });
    if(buttons.some(b=>b.id)&&buttons.some(b=>b.url||b.phoneNumber))throw new Error('回复按钮与网址/电话按钮不能混用');
    return buttons;
  }
  function delivery(item) {
    if(item.status&&item.status!=='submitted')return 'unknown';
    if(!item.messageIds?.length)return 'unknown';
    const acks=item.messageIds.map(id=>{const ack=item.receipts?.[id];return Number.isInteger(ack)&&ack>=0&&ack<=4?ack:0;});
    if(acks.every(a=>a>=3))return 'read';
    if(acks.every(a=>a>=2))return 'delivered';
    return 'submitted';
  }
  g.WAAssistantCore = { parseCSV, csv, target, recipients, dedupeContacts, personalize, Queue, parseButtons, delivery };
})(globalThis);
