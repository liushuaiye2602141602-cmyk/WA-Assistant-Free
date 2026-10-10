/* Durable scheduler. Save the dispatch state before any external send. */
(function(g) {
  'use strict';
  const allowedId = id => /^(?:\d+@(c\.us|lid)|[\d-]+@g\.us)$/.test(id || '');
  const clone = value => JSON.parse(JSON.stringify(value));
  const terminal = new Set(['completed', 'stopped']);
  class JobEngine {
    constructor(io) { this.io = io; this.serial = Promise.resolve(); this.busy = false; }
    transaction(fn) {
      const promise = this.serial.then(async()=>{ const state = await this.io.load() || { jobs:[], suppression:{} }; const result=await fn(state); await this.io.save(state); return result; });
      this.serial = promise.catch(()=>{}); return promise;
    }
    async recover() {
      await this.transaction(state=>{
        for(const job of state.jobs) for(const item of job.items) if(item.status==='sending') {
          item.status='uncertain'; item.error='执行环境中断，结果不确定。请核对聊天后人工处理'; if(!['stopped','paused'].includes(job.status))job.status='attention';
        }
      });
    }
    async create(payload) {
      const p=clone(payload); const now=this.io.now();
      if(!allowedId(p.account) || !p.consent) throw new Error('账号或收件人确认无效');
      if(!Array.isArray(p.items) || !p.items.length || p.items.some(i=>!allowedId(i.recipient?.id))) throw new Error('收件人无效');
      if(!Number.isFinite(p.minMs)||p.minMs<1000||!Number.isFinite(p.maxMs)||p.maxMs<p.minMs) throw new Error('发送间隔无效');
      if(!Number.isFinite(p.scheduledAt)||p.scheduledAt<0) throw new Error('定时时间无效');
      if(!['none','messages','chat'].includes(p.deleteMode||'none')) throw new Error('删除选项无效');
      if(p.deleteMode!=='none' && !p.deleteConfirmed) throw new Error('请明确确认自动删除范围');
      if(p.files!=null&&!Array.isArray(p.files))throw new Error('附件列表无效');
      if((p.files||[]).some(f=>!f||typeof f.mime!=='string'||!f.mime||typeof f.name!=='string'||!/^data:[^,]*;base64,/.test(f.data||''))) throw new Error('附件无效');
      if(p.items.some(i=>!String(i.text||'').trim())&&!(p.files||[]).length)throw new Error('消息内容不能为空');
      if(p.buttons?.length&&p.items.some(i=>!String(i.text||'').trim()))throw new Error('按钮消息需要文本');
      if((p.buttons||[]).length>3)throw new Error('最多三个按钮');
      const job = {id:this.io.id(),account:p.account,createdAt:now,status:'queued',scheduledAt:Math.max(now,p.scheduledAt),nextAt:Math.max(now,p.scheduledAt),minMs:p.minMs,maxMs:p.maxMs,files:p.files||[],settings:{timestamp:!!p.timestamp,buttons:p.buttons||[],deleteMode:p.deleteMode||'none',deleteConfirmed:!!p.deleteConfirmed},items:p.items.map((i,n)=>({key:String(n),recipient:i.recipient,text:String(i.text||''),status:'pending',messageIds:[],receipts:{},time:'',error:''}))};
      await this.transaction(s=>{s.jobs.push(job);}); await this.io.wake(job.nextAt); return clone(job);
    }
    async command(id, command) {
      const result=await this.transaction(s=>{
        const job=s.jobs.find(j=>j.id===id); if(!job) throw new Error('任务不存在');
        if(command==='pause' && !terminal.has(job.status)) job.status='paused';
        else if(command==='resume' && ['paused','waiting','attention'].includes(job.status)) { job.status='queued'; job.nextAt=Math.max(this.io.now(),job.scheduledAt); }
        else if(command==='stop') job.status='stopped';
        else if(command==='retry') {
          if(!['paused','attention','completed','stopped'].includes(job.status)) throw new Error('请先停止或暂停任务');
          for(const item of job.items) if(item.status==='failed') {item.status='pending';item.error='';}
          job.status='queued'; job.nextAt=this.io.now();
        } else if(!['pause','resume','stop','retry'].includes(command)) throw new Error('未知操作');
        else throw new Error('当前任务状态不能执行该操作');
        // An uncertain/partially submitted item is deliberately not retried.
        return clone(job);
      });
      if(command==='stop') await this.io.cancel?.(id);
      await this.io.wake(this.io.now()); return result;
    }
    async suppress(account, ids, reason='退订') {
      await this.transaction(s=>{ const list=s.suppression[account] ||= {}; const aliases=ids.filter(allowedId);for(const id of aliases)list[id]={at:this.io.now(),reason,aliases}; });
    }
    async unsuppress(account,id) { await this.transaction(s=>{const list=s.suppression[account]||{},aliases=list[id]?.aliases||[id];for(const alias of aliases)delete list[alias];}); }
    async canSend(jobId,key,account) {
      await this.serial; const s=await this.io.load(); const job=s?.jobs.find(j=>j.id===jobId), item=job?.items.find(i=>i.key===key);
      return !!(job && item && job.account===account && ['queued','running'].includes(job.status) && item.status==='sending' && !s.suppression[account]?.[item.recipient.id]);
    }
    async receipt(account,id,ack,groupVerified=false) {
      if(!Number.isInteger(ack)||ack<0||ack>4) return;
      await this.transaction(s=>{
        let matched=false;
        for(const job of s.jobs.filter(j=>j.account===account)) for(const item of job.items) if(item.messageIds.includes(id)){const value=item.recipient.id.endsWith('@g.us')&&!groupVerified?Math.min(1,ack):ack;item.receipts[id]=Math.max(item.receipts[id]??0,value);matched=true;}
        if(!matched){const cache=(s.earlyReceipts||={})[account]||={};const previous=cache[id];const verifiedAck=previous?.verifiedAck??(previous?.groupVerified?previous.ack:0);cache[id]={ack:Math.max(previous?.ack||0,ack),verifiedAck:Math.max(verifiedAck,groupVerified?ack:0),at:this.io.now()};const keys=Object.keys(cache);if(keys.length>1000)delete cache[keys.sort((a,b)=>cache[a].at-cache[b].at)[0]];}
      });
    }
    async checkpoint(jobId,key,id,ack=0) {
      if(!id) return;
      ack=Number.isInteger(ack)&&ack>=0&&ack<=4?ack:0;
      await this.transaction(s=>{const job=s.jobs.find(j=>j.id===jobId),item=job?.items.find(i=>i.key===key); if(!item) return; if(!item.messageIds.includes(id)) item.messageIds.push(id); const early=s.earlyReceipts?.[job.account]?.[id];const group=item.recipient.id.endsWith('@g.us');const cachedAck=group?Math.max(Math.min(1,early?.ack||0),early?.verifiedAck??(early?.groupVerified?early.ack:0)):early?.ack||0;item.receipts[id]=Math.max(item.receipts[id]??0,group?Math.min(1,ack):ack,cachedAck);if(s.earlyReceipts?.[job.account])delete s.earlyReceipts[job.account][id];});
    }
    async tick() {
      if(this.busy) return; this.busy=true;
      let dispatch;
      try {
        dispatch=await this.transaction(s=>{
          const now=this.io.now();
          const jobs=s.jobs.filter(j=>['queued','running','waiting'].includes(j.status)).sort((a,b)=>a.nextAt-b.nextAt);
          for(const job of jobs) {
            if(job.nextAt>now) continue;
            let item;
            while((item=job.items.find(i=>i.status==='pending')) && s.suppression[job.account]?.[item.recipient.id]) {item.status='optedout';item.error='已退订，跳过';}
            if(!item) {job.status='completed';continue;}
            item.status='sending'; item.dispatchAt=now; job.status='running';
            return {job:clone(job),item:clone(item)};
          }
        });
        if(!dispatch) return;
        const {job,item}=dispatch;
        let result; try {result=await this.io.execute(job,item);} catch(e) {result={ok:false,uncertain:true,error:String(e.message||e)};}
        if(!result||typeof result!=='object'||Array.isArray(result))result={ok:false,uncertain:true,error:'执行接口未返回有效结果，请核对聊天'};
        if(result.ok&&!(Array.isArray(result.messageIds)&&result.messageIds.length))result={...result,ok:false,uncertain:true,error:'未返回消息 ID，发送结果无法确认，请核对聊天'};
        await this.transaction(s=>{
          const current=s.jobs.find(j=>j.id===job.id), row=current?.items.find(i=>i.key===item.key); if(!row) return;
          row.time=new Date(this.io.now()).toISOString();
          for(const id of result.messageIds||[]) if(!row.messageIds.includes(id)) row.messageIds.push(id);
          for(const [id,ack]of Object.entries(result.receipts||{}))row.receipts[id]=Math.max(row.receipts[id]??0,row.recipient.id.endsWith('@g.us')?Math.min(1,ack):ack);
          row.error=result.error||''; row.deleteError=result.deleteError||'';
          if(result.waiting && !row.messageIds.length) {row.status='pending'; if(!['stopped','paused'].includes(current.status)) current.status='waiting';}
          else if(result.optedout && !row.messageIds.length) row.status='optedout';
          else if(result.ok) row.status='submitted';
          else if(result.uncertain || row.messageIds.length) {row.status='uncertain'; if(current.status!=='stopped') current.status='attention';}
          else row.status='failed';
          current.nextAt=this.io.now()+(result.waiting?30000:current.minMs+Math.floor(this.io.random()*(current.maxMs-current.minMs)));
          if(!current.items.some(i=>i.status==='pending') && ['running','queued'].includes(current.status)) current.status='completed';
        });
      } finally {
        this.busy=false;
        await this.serial; const s=await this.io.load(); const next=s?.jobs.filter(j=>['queued','running','waiting'].includes(j.status)).map(j=>j.nextAt);
        if(next?.length) await this.io.wake(Math.min(...next));
      }
    }
  }
  g.WAJobEngine=JobEngine;
})(globalThis);
