/**
 * Injected into WhatsApp Web page world.
 * Exposes WPPConnect Store APIs via CustomEvent bridge.
 * Events: WABK_wpp → WABK_wpp_${eventName}_result
 */
(function () {
  "use strict";
  if (window.__WABK_WPP_BRIDGE__) return;
  window.__WABK_WPP_BRIDGE__ = true;

  function getWPP() {
    return window.WPP || null;
  }

  function ready() {
    const WPP = getWPP();
    try {
      return !!(WPP && WPP.conn && WPP.conn.isMainReady && WPP.conn.isMainReady());
    } catch {
      return false;
    }
  }

  function phoneOf(jid) {
    if (!jid) return "";
    const s = String(jid);
    return s.split("@")[0].split(":")[0] || "";
  }

  function isLidJid(jid) {
    return /@lid\b/i.test(String(jid || ""));
  }

  function normalizeMessage(msg, chatHint) {
    const id = messageId(msg);
    const type = (msg && msg.type) || "chat";
    const fromMe = !!(msg && msg.id && msg.id.fromMe);
    const author = msg && (msg.author || msg.from || msg.to || "");
    const isImage = type === "image" || type === "sticker";
    const isVideo = type === "video";
    const isAudio = type === "audio" || type === "ptt";
    const isDocument = type === "document";
    const isMedia = !!(isImage || isVideo || isAudio || isDocument || (msg && msg.hasMedia));

    const timeMs = (msg && (msg.t || msg.timestamp || msg.timestampUnix)) || 0;
    const time = typeof timeMs === "number" && timeMs < 1e12 ? timeMs * 1000 : timeMs;

    // Only use reactions already on the model — never fan out getReactions per message.
    const inline = mapReactions(msg && msg.reactions);

    // 1:1 chat: prefer chat contact name/phone over raw LID from message author
    let displayName = "";
    let phone = "";
    if (fromMe) {
      displayName = "我";
    } else {
      phone = phoneOf(author);
      if (isLidJid(author) || (phone && phone.length > 12 && !/@c\.us|@s\.whatsapp\.net/i.test(String(author)))) {
        // LID — use chat-level identity when available
        displayName = (chatHint && chatHint.name) || "";
        phone = (chatHint && chatHint.phone) || "";
      } else {
        displayName = phone || "";
      }
    }

    return {
      id,
      time,
      type,
      fromMe,
      displayName,
      formattedName: displayName,
      phone,
      reactions: inline,
      isMedia,
      isImage,
      isAudio,
      isVoice: type === 'ptt',
      mimetype: (msg && (msg.mimetype || msg.mediaData?.mimetype)) || '',
      duration: Number(msg && (msg.duration || msg.mediaData?.duration)) || 0,
      isVideo,
      isDocument,
      message: type === "chat" ? msg.body || "" : "",
      caption: msg && msg.caption ? msg.caption : "",
      filename: (msg && msg.filename) || "",
      size: (msg && msg.size) || 0,
      _rawHasMedia: !!(msg && msg.hasMedia),
    };
  }

  function mapReactions(list) {
    if (!Array.isArray(list)) return [];
    return list.map((r) => ({
      text: r.aggregateEmoji || r.text || "",
      senders: (r.senders || []).map((s) => {
        const user = s && s.sender && s.sender.user;
        return user || s || "";
      }),
    }));
  }

  async function getReactionsSafe(msgId) {
    const WPP = getWPP();
    try {
      if (WPP && WPP.chat && WPP.chat.getReactions) {
        const r = await WPP.chat.getReactions(msgId);
        return mapReactions(r && r.reactions);
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  function messageId(msg) {
    const id = msg && msg.id;
    if (!id) return "";
    if (typeof id === "string") return id;
    if (id._serialized) return String(id._serialized);
    if (typeof id.toString === "function") {
      const s = id.toString();
      if (s && s !== "[object Object]") return s;
    }
    return "";
  }

  async function getMessages(params) {
    const WPP = getWPP();
    if (!WPP || !WPP.chat || !WPP.chat.getMessages) return null;
    const chats = (params && params.chats) || [];
    if (!Array.isArray(chats) || !chats.length) return null;
    // -1 = full history; large chats can be slow — caller should call per chat.
    const count = params && typeof params.count === "number" ? params.count : -1;
    const out = [];

    for (const chat of chats) {
      let raw = [];
      try {
        raw = await WPP.chat.getMessages(chat.id, { count });
      } catch (e) {
        console.warn("[WABK] getMessages failed", chat.id, e);
      }
      if (!Array.isArray(raw)) raw = [];
      // 1:1: attach chat name/phone so bubbles don't show raw LID
      const chatHint = { name: chat.name || "", phone: chat.phone || "" };
      // resolve contact once per chat if phone missing
      if (!chatHint.phone && chat.id && !String(chat.id).includes("@g.us")) {
        try {
          const info = await getContactInfo(chat.id);
          if (info) {
            if (info.name) chatHint.name = chatHint.name || info.name;
            if (info.phone) chatHint.phone = info.phone;
          }
        } catch {
          /* ignore */
        }
      }
      const items = raw
        .map((msg) => normalizeMessage(msg, chatHint))
        .filter((m) => m.id || m.message || m.caption);
      out.push({ chatId: chat.id, chatName: chat.name || chatHint.name || "", phone: chatHint.phone || "", items });
    }
    return out;
  }

  async function downloadMedia(id) {
    const WPP = getWPP();
    if (!WPP || !WPP.chat || !WPP.chat.downloadMedia) return null;
    try {
      const media = await WPP.chat.downloadMedia(id);
      // Pass bytes and MIME explicitly across the page/content-script boundary.
      if (media && typeof media.arrayBuffer === 'function') return { data: await media.arrayBuffer(), mimetype: media.type || 'application/octet-stream' };
      return media || null;
    } catch (e) {
      console.warn("[WABK] downloadMedia failed", id, e);
      return null;
    }
  }

  async function getChatList() {
    const WPP = getWPP();
    if (!WPP || !WPP.chat || !WPP.chat.list) return [];
    try {
      const list = await WPP.chat.list();
      return (list || []).map((c) => {
        const contact = c.contact || {};
        const idStr = String(c.id || c.chatId || "");
        const phone =
          contact.formattedPhone ||
          contact.phoneNumber ||
          contact.number ||
          phoneOf(contact.id) ||
          (idStr.includes("@c.us") ? phoneOf(idStr) : "");
        return {
          id: idStr,
          name:
            contact.formattedName ||
            contact.name ||
            contact.pushname ||
            c.formattedTitle ||
            c.name ||
            idStr,
          phone: phone ? String(phone).replace(/[^\d+]/g, "") : "",
        };
      });
    } catch (e) {
      console.warn("[WABK] chat.list failed", e);
      return [];
    }
  }

  /** Resolve display name + real phone for one chat (for filenames). */
  async function getContactInfo(chatId) {
    const WPP = getWPP();
    const idStr = String(chatId || "");
    let name = "";
    let phone = "";
    try {
      if (WPP && WPP.contact && WPP.contact.queryExists) {
        // may fail for @lid
      }
      if (WPP && WPP.contact && typeof WPP.contact.get === "function") {
        const contact = await WPP.contact.get(idStr);
        if (contact) {
          name = contact.formattedName || contact.name || contact.pushname || "";
          phone =
            contact.formattedPhone ||
            contact.phoneNumber ||
            contact.number ||
            phoneOf(contact.id || idStr) ||
            "";
        }
      }
    } catch {
      /* ignore */
    }
    // fallback from chat model
    try {
      if (WPP && WPP.chat && typeof WPP.chat.get === "function") {
        const chat = await WPP.chat.get(idStr);
        if (chat) {
          const contact = chat.contact || {};
          name = name || contact.formattedName || chat.formattedTitle || "";
          phone =
            phone ||
            contact.formattedPhone ||
            contact.phoneNumber ||
            phoneOf(contact.id) ||
            "";
        }
      }
    } catch {
      /* ignore */
    }
    if (!phone && idStr.includes("@c.us")) phone = phoneOf(idStr);
    phone = String(phone || "").replace(/[^\d+]/g, "");
    return { id: idStr, name: name || "", phone };
  }

  async function getActiveChat() {
    const WPP = getWPP();
    try {
      if (WPP && WPP.chat && WPP.chat.getActiveChat) {
        const c = WPP.chat.getActiveChat();
        if (!c) return null;
        const contact = c.contact || {};
        return {
          id: String(c.id || ""),
          name:
            contact.formattedName ||
            c.formattedTitle ||
            c.name ||
            String(c.id || ""),
          phone:
            contact.formattedPhone ||
            contact.phoneNumber ||
            phoneOf(contact.id) ||
            (String(c.id).includes("@c.us") ? phoneOf(String(c.id)) : ""),
        };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function getProfilePicture(chatId) {
    const WPP = getWPP();
    try {
      if (WPP && WPP.contact && WPP.contact.getProfilePictureUrl) {
        return (await WPP.contact.getProfilePictureUrl(chatId)) || "";
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  function contactRow(c) {
    const id = String(c.id || '');
    const phone = c.phoneNumber || c.formattedPhone || (/@c\.us$/.test(id) ? phoneOf(id) : '');
    return { id, phone: String(phone).replace(/[^\d+]/g, ''), name: c.name || c.formattedName || c.pushname || '', saved: !!c.isMyContact };
  }

  async function assistantContacts(params) {
    const WPP = getWPP();
    if (!WPP?.contact?.list) throw new Error('当前 WhatsApp 版本不支持联系人列表');
    const options = params?.label ? { withLabels: [params.label] } : {};
    let rows = (await WPP.contact.list(options)).map(contactRow).filter(c => /@(c\.us|lid)$/.test(c.id));
    if (params?.filter === 'saved') rows = rows.filter(c => c.saved);
    if (params?.filter === 'unsaved') rows = rows.filter(c => !c.saved);
    return rows;
  }

  async function assistantGroup(params) {
    const WPP = getWPP();
    if (!/@g\.us$/.test(params?.id || '')) throw new Error('请选择一个群组');
    if (!WPP?.group?.getParticipants) throw new Error('群成员接口不可用');
    const participants = await WPP.group.getParticipants(params.id);
    const result = [];
    for (const p of participants) {
      if (params.excludeAdmins && (p.isAdmin || p.isSuperAdmin)) continue;
      let contact = p;
      try { contact = await WPP.contact.get(String(p.id)); } catch { /* member may lack contact */ }
      result.push({ ...contactRow(contact || p), id: String(p.id), admin: !!(p.isAdmin || p.isSuperAdmin) });
    }
    return result;
  }

  let watchInstalled = false;
  let policy = { autoOptout: true, keywords: ['退订','取消订阅','stop','unsubscribe','不要再发'], suppression: new Set() };
  const cancelledJobs = new Set();
  const trackedMessages = new Set();
  const normalizedText = text => String(text || '').normalize('NFKC').trim().toLowerCase().replace(/[.!！。?？]+$/g,'').trim();
  function pageEvent(detail) { window.dispatchEvent(new CustomEvent('WAA_page_event',{detail})); }
  async function optoutIds(id) {
    const ids = new Set([id]);
    try {
      const c = await getWPP().contact.get(id);
      const pn = String(c?.phoneNumber || c?.formattedPhone || '').replace(/\D/g,'');
      if(pn)ids.add(pn+'@c.us');
      if(c?.id)ids.add(String(c.id));
      if(c?.lid)ids.add(String(c.lid));
    }catch{ /* preserve original ID */ }
    return [...ids];
  }
  async function markOptout(id) {
    const ids=await optoutIds(id); ids.forEach(x=>policy.suppression.add(x));
    pageEvent({type:'optout',account:String(getWPP()?.conn?.getMyUserId?.()||''),ids});
  }
  function wantsOptout(msg) {return !msg?.id?.fromMe && policy.autoOptout && policy.keywords.includes(normalizedText(msg?.body));}
  async function assistantWatch(params) {
    policy={autoOptout:params?.autoOptout!==false,keywords:(params?.keywords||policy.keywords).map(normalizedText),suppression:new Set(params?.suppression||[])};
    const WPP=getWPP();
    if(!watchInstalled&&typeof WPP?.on==='function') {
      WPP.on('chat.new_message',msg=>{
        const id=String(msg?.id?.remote||msg?.from||'');
        if(/@(c\.us|lid)$/.test(id)&&wantsOptout(msg)) void markOptout(id).catch(console.warn);
      });
      WPP.on('chat.msg_ack_change',event=>{
        const ids=(event?.ids||[]).map(String);
        pageEvent({type:'receipt',account:String(WPP.conn.getMyUserId()||''),ids,ack:event.ack});
        for(const id of ids.filter(id=>id.includes('@g.us')&&trackedMessages.has(id)))void assistantReceipts({ids:[id]}).then(rows=>{for(const r of rows)if(!r.unknown)pageEvent({type:'receipt',account:String(WPP.conn.getMyUserId()||''),ids:[id],ack:r.ack,groupVerified:true});}).catch(console.warn);
      });
      watchInstalled=true;
    }
    return {listening:watchInstalled};
  }
  async function checkpoint(params,id,ack) {
    if(!params.jobId||!id)return;
    const token=params.jobId+':'+params.key+':'+id;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{window.removeEventListener('WAA_checkpoint_saved',onResult);reject(new Error('发送已提交，但结果保存超时'));},15000);
      function onResult(e){if(e.detail?.token!==token)return;clearTimeout(timer);window.removeEventListener('WAA_checkpoint_saved',onResult);e.detail.ok?resolve():reject(new Error(e.detail.error));}
      window.addEventListener('WAA_checkpoint_saved',onResult);
      pageEvent({type:'checkpoint',jobId:params.jobId,key:params.key,id,ack,token});
    });
  }
  async function assistantReceipts(params) {
    const WPP=getWPP(); const result=[];
    for(const id of params?.ids||[]) {
      try {
        const m=await WPP.chat.getMessageACK(id);const participants=m.participants||[];
        const delivered=participants.filter(p=>p.deliveredAt||p.readAt||p.playedAt).length,read=participants.filter(p=>p.readAt||p.playedAt).length;
        const group=String(id).includes('@g.us');
        const ack=group?(participants.length&&m.readRemaining===0&&read?3:participants.length&&m.deliveryRemaining===0&&delivered?2:Math.min(1,Number(m.ack)||0)):Number(m.ack)||0;
        result.push({id,ack,groupVerified:group,delivered,read,deliveryRemaining:m.deliveryRemaining,readRemaining:m.readRemaining});
      }
      catch(e){result.push({id,unknown:true,error:String(e.message||e)});}
    }
    return result;
  }
  async function assistantActivity(params) {
    const WPP=getWPP();const id=params.id;
    const existence=await WPP.contact.queryExists(id); if(!existence?.wid)return {exists:false,activity:'unknown'};
    let lastSeen=0,lastInbound=0;
    try {const value=await WPP.chat.getLastSeen(id); if(typeof value==='number'&&value>0)lastSeen=value<1e12?value*1000:value;}catch{ /* hidden presence */ }
    try {const messages=await WPP.chat.getMessages(id,{count:30});for(const m of messages||[])if(!m.id?.fromMe){const t=Number(m.t||m.timestamp||0);lastInbound=Math.max(lastInbound,t<1e12?t*1000:t);}}catch{ /* history unavailable */ }
    const latest=Math.max(lastSeen,lastInbound);const days=Number(params.days)||30;
    return {exists:true,lastSeen,lastInbound,activity:latest&&latest>=Date.now()-days*86400000?'recent':'unknown',days};
  }

  // No retries inside the bridge: a timeout must never silently duplicate a send.
  async function assistantSend(params) {
    if (!ready()) throw new Error('WhatsApp 尚未连接');
    const WPP = getWPP(); const id = String(params?.id || '');
    if (!/^(?:\d+@(c\.us|lid)|[\d-]+@g\.us)$/.test(id)) throw new Error('收件人 ID 无效');
    const ids=[],receipts={};let attempted=false;
    const guard=()=>{
      if(params.account&&String(WPP.conn.getMyUserId())!==params.account)throw new Error('账号已变化');
      if(cancelledJobs.has(params.jobId))throw new Error('任务已停止');
      if(policy.suppression.has(id))throw new Error('收件人已退订');
    };
    try {
      guard();
      if(policy.autoOptout&&/@(c\.us|lid)$/.test(id)&&typeof WPP.chat.getMessages==='function') {
        const recent=await WPP.chat.getMessages(id,{count:30});
        if((recent||[]).some(wantsOptout)){await markOptout(id);return {ok:false,optedout:true,error:'已识别退订，跳过收件人'};}
      }
      const settings=params.settings||{};
      if(!['none','messages','chat'].includes(settings.deleteMode||'none'))throw new Error('删除设置无效');
      if(settings.deleteMode&&settings.deleteMode!=='none'&&!settings.deleteConfirmed)throw new Error('没有确认自动删除');
      if(settings.buttons?.length && !params.text)throw new Error('按钮消息需要文本内容');
      if(settings.buttons?.length>3)throw new Error('最多三个按钮');
      // Validate every attachment before sending any part of this recipient's payload.
      if(params.files!=null&&!Array.isArray(params.files))throw new Error('附件列表无效');
      for(const f of params.files||[])if(!f||typeof f.mime!=='string'||!f.mime||typeof f.name!=='string'||!/^data:[^,]*;base64,/.test(f.data||''))throw new Error('附件数据无效');
      async function remember(result){
        const msgId=messageId(result);if(!msgId)throw new Error('接口未返回消息 ID，结果需要核对');
        ids.push(msgId);trackedMessages.add(msgId);receipts[msgId]=Number(result?.ack)||0;await checkpoint(params,msgId,receipts[msgId]);
      }
      if(params.text) {
        guard(); attempted=true;
        const text=String(params.text)+(settings.timestamp?'\n发送时间：'+new Date().toLocaleString():'');
        const options={createChat:true};if(settings.buttons?.length){options.buttons=settings.buttons;options.useInteractiveMessage=true;}
        await remember(await WPP.chat.sendTextMessage(id,text,options));
      }
      for(const f of params.files||[]) {
        guard();attempted=true;
        const type=f.mime.startsWith('image/')?'image':f.mime.startsWith('video/')?'video':f.mime.startsWith('audio/')?'audio':'document';
        await remember(await WPP.chat.sendFileMessage(id,f.data,{type,filename:f.name,mimetype:f.mime,createChat:true,isPtt:!!f.isPtt}));
      }
      let deleteError='';
      try {
        guard();
        if(settings.deleteMode==='messages'&&ids.length)await WPP.chat.deleteMessage(id,ids,false,false);
        if(settings.deleteMode==='chat')await WPP.chat.delete(id);
      }catch(e){deleteError='发送完成，但删除失败：'+String(e.message||e);}
      return {ok:true,submitted:true,messageIds:ids,receipts,deleteError};
    }catch(e){return {ok:false,uncertain:attempted,optedout:!attempted&&policy.suppression.has(id),messageIds:ids,receipts,error:String(e.message||e)};}
  }

  const handlers = {
    assistantAccount: () => String(getWPP()?.conn?.getMyUserId?.() || ''),
    assistantContacts,
    assistantGroup,
    assistantSend,
    assistantWatch,
    assistantReceipts,
    assistantActivity,
    assistantCancel: params => {cancelledJobs.add(params.jobId);return true;},
    assistantCheck: async (params) => {
      const WPP = getWPP();
      if (!WPP?.contact?.queryExists) throw new Error('号码检查接口不可用');
      const result = await WPP.contact.queryExists(params.id);
      return { exists: !!result?.wid };
    },
    isMainReady: () => ready(),
    keepAlive: () => {
      try {
        getWPP()?.conn?.setKeepAlive?.(true);
      } catch {
        /* ignore */
      }
      return true;
    },
    getChatList,
    getActiveChat,
    getContactInfo: (params) => getContactInfo(params && params.chatId),
    getMessages,
    downloadMedia: (params) => downloadMedia(params && params.id),
    getProfilePicture: (params) => getProfilePicture(params && params.chatId),
  };

  window.addEventListener("WABK_wpp", async (event) => {
    const detail = event.detail || {};
    const eventName = detail.eventName || "";
    const params = detail.params || {};
    const requestId = detail.requestId || "";
    const fn = Object.hasOwn(handlers, eventName) ? handlers[eventName] : null;
    let payload = null;
    let error = null;
    try {
      payload = fn ? await fn(params) : { error: "unknown event " + eventName };
      if (payload && payload.error && typeof payload.ok !== 'boolean') error = payload.error;
    } catch (e) {
      error = String((e && e.message) || e);
      payload = { error };
    }
    // Single correlated result channel — avoids same-event cross-talk.
    const out = { requestId, eventName, ok: !error, data: error ? null : payload, error };
    try {
      window.dispatchEvent(new CustomEvent("WABK_wpp_result", { detail: out }));
    } catch (cloneErr) {
      // e.g. DataCloneError on unexpected payloads
      window.dispatchEvent(
        new CustomEvent("WABK_wpp_result", {
          detail: {
            requestId,
            eventName,
            ok: false,
            data: null,
            error: "result not cloneable: " + cloneErr,
          },
        })
      );
    }
  });

  console.info("[WABK] WPP bridge installed");
})();
