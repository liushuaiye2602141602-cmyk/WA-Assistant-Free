/**
 * Export Markdown / ZIP from WPP-normalized messages.
 */
(function (global) {
  "use strict";

  function safeFilename(name) {
    const safe = (
      String(name || "chat")
        .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80).replace(/[ .]+$/, '') || "chat"
    );
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)?'_'+safe:safe;
  }

  /**
   * Export basename: 「对方名称 - WhatsApp号码」
   * @param {string} title
   * @param {string} chatId  e.g. 86138…@c.us or 227…@lid
   * @param {string} [phone] real phone from WPP contact (preferred over jid prefix)
   */
  function exportBaseName(title, chatId, phone) {
    const name = safeFilename(title || "chat");
    let num = String(phone || "").replace(/[^\d+]/g, "");
    if (!num) {
      const id = String(chatId || "").trim();
      // Only use jid prefix as number when it's a real user jid (@c.us / @s.whatsapp.net)
      if (/@c\.us|@s\.whatsapp\.net/i.test(id)) {
        num = id.split("@")[0].split(":")[0].replace(/\D/g, "");
      } else if (id && !id.includes("@")) {
        num = id.replace(/\D/g, "");
      }
      // @lid / @g.us: do not treat lid as phone
    }
    num = num.replace(/\D/g, "");
    if (!num) return name;
    return `${name} - ${num}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function formatTime(ms) {
    if (!ms) return "";
    const d = new Date(Number(ms));
    if (Number.isNaN(d.getTime())) return String(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function formatNow() {
    return formatTime(Date.now());
  }

  function looksLikeLid(value) {
    const s = String(value || "");
    return /^\d{10,}$/.test(s);
  }

  function whoLabel(m, chat) {
    if (m.fromMe) return "我";
    let name = m.displayName || m.formattedName || "";
    // Drop LID / raw long digits that are not a known phone
    if (looksLikeLid(name) && !(chat && chat.phone === name)) name = "";
    if (name && name !== "联系人") return name;

    let phone = m.phone || "";
    if (looksLikeLid(phone) && !(chat && chat.phone === phone)) phone = "";
    if (phone) return phone;

    if (chat && chat.phone && !looksLikeLid(chat.phone)) return chat.phone;
    if (chat && chat.title && chat.title !== chat.chatId) return chat.title;
    return "联系人";
  }

  function mediaKindLabel(m) {
    if (m.isImage) return "image";
    if (m.isVideo) return "video";
    if (m.isAudio || m.type === 'ptt' || m.type === 'audio') return "audio";
    if (m.isDocument) return "document";
    return m.type || "file";
  }

  function defaultExt(m, mime) {
    const type = String(mime || m.mimetype || '').split(';')[0].trim().toLowerCase();
    const audioExt = { 'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac', 'audio/amr': 'amr', 'audio/3gpp': '3gp' };
    if (mediaKindLabel(m) === 'audio' && audioExt[type]) return audioExt[type];
    const k = mediaKindLabel(m);
    if (k === "image") return "jpg";
    if (k === "video") return "mp4";
    if (k === "audio") return "ogg";
    return "bin";
  }

  function mediaFilename(m, index, mime) {
    if (m.filename && m.filename.includes('.')) {
      const safe = safeFilename(m.filename);
      const type = String(mime || m.mimetype || '').toLowerCase();
      if (mediaKindLabel(m) === 'audio' && type && type !== 'application/octet-stream') return safe.replace(/\.[^.]+$/, '') + '.' + defaultExt(m, type);
      return safe;
    }
    return `${mediaKindLabel(m)}_${String(index).padStart(3, "0")}.${defaultExt(m, mime)}`;
  }

  /** Display title aligned with export filename: 「名字 - 号码」 */
  function displayTitle(chat) {
    const name = chat.title || chat.chatName || "WhatsApp Chat";
    const base = exportBaseName(name, chat.chatId || chat.id, chat.phone);
    // exportBaseName returns name only when no phone — then keep · WhatsApp for readability
    if (base === name) return `${name} · WhatsApp`;
    return base;
  }

  function buildMarkdownHeader(chat, messages, mediaCount) {
    const name = chat.title || chat.chatName || "WhatsApp Chat";
    const title = displayTitle(chat);
    const rows = [
      ["聊天", name],
      ["Chat ID", chat.chatId || chat.id || ""],
      ["WhatsApp 号码", chat.phone || ""],
      ["导出时间", formatNow()],
      ["消息数", String(messages.length)],
      ["媒体数", String(mediaCount)],
    ];
    const md = [
      `# ${title}`,
      "",
      "| 项目 | 内容 |",
      "| --- | --- |",
      ...rows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, "\\|")} |`),
      "",
      "---",
      "",
    ];
    return md.join("\n");
  }

  function messageMarkdown(m, mediaMode, filename, chat) {
    const lines = [];
    const who = whoLabel(m, chat);
    const time = formatTime(m.time);
    lines.push(`**${who} · ${time}**`);
    lines.push("");

    const body = (m.message || m.caption || "").trim();
    if (body) lines.push(body);

    if (m.isMedia || m._rawHasMedia) {
      const name = m.exportFilename || filename || mediaFilename(m, 0);
      if (m.mediaMissing) {
        lines.push(`⚠ ${mediaKindLabel(m) === 'audio' ? '语音/音频' : '媒体'}下载失败：${name}${m.mediaError ? '（' + m.mediaError + '）' : ''}`);
      } else if (mediaMode === "relative") {
        const path = 'media/' + encodeURIComponent(name);
        const label = name.replace(/[\[\]\\]/g, '\\$&');
        if (mediaKindLabel(m) === "image") lines.push(`![${label}](${path})`);
        else if (mediaKindLabel(m) === "video") lines.push(`📹 [${label}](${path})`);
        else if (mediaKindLabel(m) === "audio") lines.push(`🎧 [${label}](${path})`);
        else lines.push(`📎 [${label}](${path})`);
      } else {
        const icon =
          mediaKindLabel(m) === "image"
            ? "📷 图片"
            : mediaKindLabel(m) === "video"
              ? "📹 视频"
              : mediaKindLabel(m) === "audio"
                ? "🎧 语音"
                : "📎 文件";
        lines.push(`${icon}: \`${name}\``);
      }
    }

    if (m.reactions && m.reactions.length) {
      const rx = m.reactions
        .map((r) => `${r.text}${r.senders && r.senders.length ? "(" + r.senders.join(",") + ")" : ""}`)
        .join(" ");
      lines.push("");
      lines.push(`> 反应: ${rx}`);
    }

    return lines.join("\n");
  }

  /** Drop duplicate messages (same id / same text+time+fromMe). */
  function dedupeMessages(list) {
    const seen = new Set();
    const out = [];
    for (const m of list || []) {
      const key =
        m.id ||
        `${m.fromMe}|${m.time}|${m.type}|${m.message || ""}|${m.caption || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      if (!blob) return resolve("");
      if (typeof FileReader === "undefined") {
        // non-browser (tests)
        Promise.resolve(blob.arrayBuffer())
          .then((buf) => {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
            resolve(`data:${blob.type || "application/octet-stream"};base64,${b64}`);
          })
          .catch(() => resolve(""));
        return;
      }
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve("");
      r.readAsDataURL(blob);
    });
  }

  /** Fetch avatar URL → data URL for embedding in HTML. */
  async function fetchAvatarDataURL(chatId) {
    try {
      const url = await WABridge.getProfilePicture(chatId);
      if (!url || typeof url !== "string") return "";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return "";
      const blob = await res.blob();
      if (!blob || !blob.size) return "";
      return await blobToDataURL(blob);
    } catch {
      return "";
    }
  }

  /**
   * WhatsApp-like HTML export.
   * @param {object} opts { mediaMode, mediaMap, avatarDataURL }
   * Header: 「对方名称 · WhatsApp」+ 头像
   */
  async function toHtml(chat, messages, opts = {}) {
    const mediaMode = opts.mediaMode || "none";
    const mediaMap = opts.mediaMap || new Map();
    const contactName = chat.title || chat.chatName || "WhatsApp Chat";
    const headerTitle = displayTitle(chat);
    const avatar = opts.avatarDataURL || "";
    const cards = [];
    let mediaIdx = 0;
    let prevFromMe = null;
    let prevDay = "";

    const dayLabel = (ms) => {
      if (!ms) return "";
      const d = new Date(Number(ms));
      if (Number.isNaN(d.getTime())) return "";
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    };

    for (const m of messages) {
      const who = whoLabel(m, chat);
      const time = formatTime(m.time).split(" ").slice(1).join(" ") || formatTime(m.time);
      const body = (m.message || m.caption || "").trim();
      const mediaHtml = [];

      // WhatsApp-style date separator
      const day = dayLabel(m.time);
      if (day && day !== prevDay) {
        cards.push(`<div class="day"><span>${escHtml(day)}</span></div>`);
        prevDay = day;
        prevFromMe = null;
      }

      if (m.isMedia || m._rawHasMedia) {
        mediaIdx += 1;
        const name = m.exportFilename || mediaFilename(m, mediaIdx);
        const blob = mediaMap.get(name) || null;
        let src = "";
        if (mediaMode === "embed" && blob) {
          src = await blobToDataURL(blob);
        } else if (mediaMode === "relative" && blob && !m.mediaMissing) {
          src = "media/" + encodeURIComponent(name);
        }

        if (mediaKindLabel(m) === "image" && src) {
          mediaHtml.push(
            `<div class="media"><a href="${escHtml(src)}" target="_blank" download="${escHtml(name)}"><img src="${escHtml(src)}" alt="${escHtml(name)}" loading="lazy"></a></div>`
          );
        } else if (mediaKindLabel(m) === "video" && src) {
          mediaHtml.push(
            `<div class="media"><video controls playsinline src="${escHtml(src)}"></video></div>`
          );
        } else if (mediaKindLabel(m) === "audio" && src) {
          mediaHtml.push(
            `<div class="media"><audio controls preload="metadata" src="${escHtml(src)}">浏览器不支持播放此音频，请下载文件。</audio>${m.duration ? `<small> ${escHtml(m.duration)} 秒</small>` : ''}<a href="${escHtml(src)}" download="${escHtml(name)}">下载${m.isVoice || m.type === 'ptt' ? '语音' : '音频'}</a></div>`
          );
        } else if (src) {
          mediaHtml.push(
            `<div class="media file"><a href="${escHtml(src)}" download="${escHtml(name)}">📎 ${escHtml(name)}</a></div>`
          );
        } else {
          mediaHtml.push(`<div class="media file">${m.mediaMissing ? '⚠ ' + (mediaKindLabel(m) === 'audio' ? '语音/音频' : '媒体') + '下载失败：' : '📎 '}${escHtml(name)}${m.mediaError ? '（' + escHtml(m.mediaError) + '）' : ''}</div>`);
        }
        if (body) mediaHtml.push(`<div class="caption">${escHtml(body).replace(/\n/g, "<br>")}</div>`);
      }

      const bodyHtml =
        !m.isMedia && !m._rawHasMedia && body
          ? `<div class="text">${escHtml(body).replace(/\n/g, "<br>")}</div>`
          : "";

      // Group sender name only on first incoming of a run (like WA groups / export tools)
      const showName = !m.fromMe && prevFromMe !== false;
      const nameHtml = showName
        ? `<div class="who">${escHtml(who)}</div>`
        : "";

      const rx =
        m.reactions && m.reactions.length
          ? `<div class="rx">${escHtml(m.reactions.map((r) => r.text).join(" "))}</div>`
          : "";

      const tail = prevFromMe === m.fromMe ? " tight" : "";

      cards.push(`
<article class="msg ${m.fromMe ? "out" : "in"}${tail}">
  <div class="bubble">
    ${nameHtml}
    ${mediaHtml.join("\n")}
    ${bodyHtml}
    ${rx}
    <div class="meta"><span class="time">${escHtml(time)}</span></div>
  </div>
</article>`);

      prevFromMe = m.fromMe;
    }

  /**
   * Approximate WhatsApp light doodle wallpaper (inline SVG, no network).
   * Beige base #EFE7DE + faint line-art icons.
   */
  const WA_BG_SVG = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960">
  <rect width="540" height="960" fill="#efe7de"/>
  <g fill="none" stroke="#d0c4b4" stroke-width="1.2" opacity="0.55">
    <circle cx="60" cy="70" r="14"/><path d="M52 70h16M60 62v16"/>
    <rect x="140" y="40" width="22" height="28" rx="4"/><circle cx="151" cy="78" r="3"/>
    <path d="M240 48c8-10 28-10 36 0-8 18-28 18-36 0z"/>
    <circle cx="360" cy="55" r="16"/><path d="M352 55h16M360 47v16"/>
    <path d="M450 40l18 32h-36z"/>
    <path d="M40 160h30v22H40zM48 160v-8a7 7 0 0 1 14 0v8"/>
    <circle cx="160" cy="175" r="12"/><path d="M160 167v16"/>
    <path d="M250 155c20 0 20 30 0 30s-20-30 0-30z"/>
    <rect x="340" y="150" width="28" height="18" rx="3"/><path d="M348 158h12"/>
    <path d="M460 150v36M448 162h24"/>
    <circle cx="70" cy="280" r="18"/><path d="M62 280h16M70 272v16"/>
    <path d="M150 260l20 40h-40z"/>
    <rect x="240" y="265" width="32" height="22" rx="6"/>
    <path d="M340 260c12-8 28 4 20 20-14 8-28-4-20-20z"/>
    <circle cx="460" cy="280" r="10"/>
    <path d="M50 400h36l-18 28z"/>
    <circle cx="170" cy="410" r="14"/>
    <rect x="250" y="395" width="24" height="30" rx="3"/>
    <path d="M350 400c18 0 18 24 0 24"/>
    <path d="M450 395v30M438 410h24"/>
    <circle cx="80" cy="520" r="12"/>
    <path d="M160 505l22 30h-44z"/>
    <rect x="250" y="508" width="30" height="20" rx="4"/>
    <path d="M350 510h28v24h-28z"/>
    <circle cx="460" cy="520" r="16"/><path d="M452 520h16"/>
    <path d="M60 640c10-16 30-16 40 0-10 16-30 16-40 0z"/>
    <rect x="160" y="625" width="26" height="26" rx="4"/>
    <circle cx="270" cy="640" r="14"/>
    <path d="M350 625v30M338 640h24"/>
    <path d="M450 630l16 24h-32z"/>
    <circle cx="70" cy="760" r="15"/>
    <path d="M150 745h32v24h-32z"/>
    <path d="M250 750c20 0 20 28 0 28"/>
    <rect x="340" y="748" width="28" height="20" rx="5"/>
    <circle cx="460" cy="760" r="12"/><path d="M460 752v16"/>
    <path d="M55 880l18 28h-36z"/>
    <circle cx="160" cy="890" r="13"/>
    <rect x="240" y="875" width="30" height="24" rx="4"/>
    <path d="M350 880h26v20h-26z"/>
    <path d="M450 875v30M438 890h24"/>
  </g>
</svg>`)}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(headerTitle)}</title>
<style>
  :root { --bg:#efe7de; --in:#fff; --out:#d9fdd3; --ink:#111b21; --muted:#667781; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--ink);
    background-color: var(--bg);
    background-image: url("${WA_BG_SVG}");
    background-repeat: repeat;
    background-size: 540px 960px;
  }
  .top {
    position: sticky; top: 0; z-index: 2;
    background: #008069; color: #fff; padding: 12px 20px;
    box-shadow: 0 1px 4px rgba(0,0,0,.2);
    display: flex; align-items: center; gap: 12px;
  }
  .top .avatar {
    width: 48px; height: 48px; min-width: 48px;
    border-radius: 50%; object-fit: cover;
    background: rgba(255,255,255,.2);
    box-shadow: 0 0 0 2px rgba(255,255,255,.35);
  }
  .top .avatar-fallback {
    width: 48px; height: 48px; min-width: 48px;
    border-radius: 50%;
    background: rgba(255,255,255,.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 700; color: #fff;
  }
  .top .info { min-width: 0; }
  .top h1 { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; }
  .top p { margin: 2px 0 0; font-size: 12px; opacity: .92; }
  .thread {
    max-width: 920px; margin: 0 auto; padding: 14px 16px 48px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .day {
    align-self: center; margin: 12px 0 8px;
  }
  .day span {
    background: #fff; color: #54656f;
    font-size: 12px; font-weight: 500;
    padding: 5px 12px; border-radius: 8px;
    box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
  }
  .msg {
    display: flex;
    max-width: min(72%, 640px);
    align-self: flex-start;
  }
  .msg.out { align-self: flex-end; }
  .msg.tight { margin-top: -2px; }
  .bubble {
    position: relative;
    background: var(--in);
    color: var(--ink);
    border-radius: 8px;
    padding: 6px 8px 5px;
    box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
    min-width: 80px;
  }
  .msg.out .bubble { background: var(--out); }
  /* small tail */
  .msg.in:not(.tight) .bubble::before {
    content: "";
    position: absolute; top: 0; left: -7px;
    border-width: 0 8px 8px 0; border-style: solid;
    border-color: transparent var(--in) transparent transparent;
  }
  .msg.out:not(.tight) .bubble::after {
    content: "";
    position: absolute; top: 0; right: -7px;
    border-width: 0 0 8px 8px; border-style: solid;
    border-color: transparent transparent transparent var(--out);
  }
  .who {
    font-size: 12.5px; font-weight: 600;
    color: #00a5f4; margin: 0 0 2px 2px;
  }
  .text {
    font-size: 14.2px; line-height: 1.4;
    white-space: pre-wrap; word-break: break-word;
    padding: 0 4px;
  }
  .media { margin: 2px 0 4px; }
  .media img, .media video {
    max-width: min(360px, 100%); border-radius: 6px; display: block;
    background: #d9d9d9;
  }
  .media audio { width: min(280px, 100%); }
  .media.file a { color: #027eb5; text-decoration: none; font-size: 13px; padding: 0 4px; }
  .rx { margin-top: 4px; font-size: 12px; color: var(--muted); padding: 0 4px; }
  .meta {
    display: flex; justify-content: flex-end; align-items: center; gap: 4px;
    margin-top: 2px; min-height: 14px;
  }
  .meta .time {
    font-size: 11px; color: var(--muted);
  }
</style>
</head>
<body>
  <div class="top">
    ${
      avatar
        ? `<img class="avatar" src="${escHtml(avatar)}" alt="${escHtml(contactName)}">`
        : `<div class="avatar-fallback" aria-hidden="true">${escHtml((contactName || "?").trim().charAt(0).toUpperCase())}</div>`
    }
    <div class="info">
      <h1>${escHtml(headerTitle)}</h1>
      <p>${escHtml(chat.phone || chat.chatId || chat.id || "")} · ${messages.length} 条 · 导出 ${escHtml(formatNow())}</p>
    </div>
  </div>
  <div class="thread">
${cards.join("\n")}
  </div>
</body>
</html>`;
  }

  const WAExporter = {
    safeFilename,
    downloadBlob,
    formatTime,
    dedupeMessages,
    exportBaseName,
    displayTitle,
    toHtml,

    toMarkdown(chat, messages, opts = {}) {
      const mediaMode = opts.mediaMode || "names";
      const mediaCount = messages.reduce(
        (n, m) => n + (m.isMedia || m._rawHasMedia ? 1 : 0),
        0
      );
      const parts = [buildMarkdownHeader(chat, messages, mediaCount)];
      if (opts.subtitle) {
        parts.push(`> ${opts.subtitle}`, "");
        parts.push("---", "");
      }
      let mediaIdx = 0;
      for (const m of messages) {
        if (m.isMedia || m._rawHasMedia) mediaIdx += 1;
        parts.push(
          messageMarkdown(
            m,
            mediaMode,
            m.isMedia || m._rawHasMedia ? mediaFilename(m, mediaIdx) : null,
            chat
          )
        );
        parts.push("", "---", "");
      }
      parts.push(`_由 WA Chats Backup Pro 导出 · ${formatNow()}_`);
      return parts.join("\n");
    },

    toTxt(chat, messages) {
      const lines = [
        `Chat: ${chat.title || chat.chatName}`,
        `Exported: ${formatNow()}`,
        `Messages: ${messages.length}`,
        "=".repeat(48),
        "",
      ];
      for (const m of messages) {
        lines.push(`[${formatTime(m.time) || "?"}] ${whoLabel(m, chat)}:`);
        if (m.message || m.caption) lines.push(m.message || m.caption);
        if (m.isMedia || m._rawHasMedia) lines.push(`  <${mediaKindLabel(m)}> ${m.exportFilename || mediaFilename(m, 0)}${m.mediaMissing ? ' [媒体下载失败]' : ''}`);
        if (m.reactions && m.reactions.length) {
          lines.push("  reactions: " + m.reactions.map((r) => r.text).join(" "));
        }
        lines.push("");
      }
      return lines.join("\n");
    },

    toJson(chat, messages) {
      return JSON.stringify(
        {
          chat: {
            title: chat.title || chat.chatName,
            chatId: chat.chatId || chat.id || null,
            exportedAt: new Date().toISOString(),
          },
          messages: messages.map((m) => ({
            id: m.id,
            fromMe: !!m.fromMe,
            sender: whoLabel(m, chat),
            time: m.time || null,
            type: m.type,
            text: m.message || m.caption || "",
            reactions: m.reactions || [],
            isMedia: !!(m.isMedia || m._rawHasMedia),
            filename: m.exportFilename || m.filename || null,
            isAudio: !!(m.isAudio || m.type === 'ptt' || m.type === 'audio'),
            isVoice: !!(m.isVoice || m.type === 'ptt'),
            mimetype: m.exportMimetype || m.mimetype || null,
            duration: m.duration || null,
            mediaMissing: !!m.mediaMissing,
            mediaError: m.mediaError || null,
          })),
        },
        null,
        2
      );
    },

    /**
     * @param {Array} mediaFiles [{filename, blob}]
     */
    async toZip(chat, messages, mediaFiles, onProgress, opts = {}) {
      const zip = new WAZip.ZipWriter();
      const base = exportBaseName(chat.title || chat.chatName, chat.chatId || chat.id, chat.phone);
      if (onProgress) onProgress("构建文档…", 0, 1);
      const md = this.toMarkdown(chat, messages, {
        mediaMode: "relative",
        subtitle: "媒体文件见 `media/` 目录。",
      });
      await zip.add(`${base}/chat.md`, md);

      const mediaMap = new Map();
      for (const f of mediaFiles || []) {
        if (f.blob) mediaMap.set(f.filename, f.blob);
      }
      const missing = (mediaFiles || []).filter(f => f.missing);
      if (missing.length) await zip.add(`${base}/媒体下载失败.txt`, missing.map(f => `${f.filename} · ${f.messageId || ''} · ${f.error || '媒体不可用'}`).join('\n'));
      if (onProgress) onProgress("构建 HTML…");
      const html = await toHtml(chat, messages, {
        mediaMode: mediaMap.size ? "relative" : "none",
        mediaMap,
        avatarDataURL: opts.avatarDataURL || "",
      });
      await zip.add(`${base}/chat.html`, html);

      const used = new Set();
      let i = 0;
      const files = mediaFiles || [];
      for (const f of files) {
        i += 1;
        if (onProgress) onProgress(`打包 ${f.filename}`, i, files.length);
        if (!f.blob) continue;
        let name = f.filename || `file_${i}.bin`;
        if (used.has(name)) {
          const dot = name.lastIndexOf(".");
          const stem = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          name = `${stem}_${i}${ext}`;
        }
        used.add(name);
        await zip.add(`${base}/media/${name}`, f.blob);
      }
      if (onProgress) onProgress("生成 ZIP…", files.length, files.length);
      return zip.build();
    },

    /**
     * WPP media result → Blob
     * downloadMedia may return: Blob | {data,mimetype} | data URL string | null
     */
    mediaResultToBlob(result, fallbackMime = '') {
      if (!result) return null;
      const mime = result.mimetype || result.mimeType || fallbackMime || 'application/octet-stream';
      if (Object.prototype.toString.call(result) === '[object Blob]') return new Blob([result], { type: result.type && result.type !== 'application/octet-stream' ? result.type : mime });
      if (Object.prototype.toString.call(result) === '[object ArrayBuffer]' || ArrayBuffer.isView(result)) return new Blob([result], { type: mime });
      if (typeof result === "string") {
        if (result.startsWith("data:")) {
          try {
            const [head, b64] = result.split(",");
            const mime = (head.match(/data:([^;]+)/) || [])[1] || fallbackMime || "application/octet-stream";
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: mime });
          } catch {
            return null;
          }
        }
        return null;
      }
      if (result.data) {
        if (Object.prototype.toString.call(result.data) === '[object ArrayBuffer]' || ArrayBuffer.isView(result.data)) return new Blob([result.data], { type: mime });
        if (Array.isArray(result.data)) return new Blob([new Uint8Array(result.data)], { type: mime });
        let b64 = result.data;
        if (typeof b64 !== 'string') return null;
        if (b64.startsWith('data:')) return this.mediaResultToBlob(b64, mime);
        try {
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return new Blob([arr], { type: mime });
        } catch {
          return null;
        }
      }
      return null;
    },

    async fetchMediaForMessages(messages, onProgress) {
      const files = [];
      const mediaMsgs = messages.filter((m) => m.isMedia || m._rawHasMedia);
      const used = new Set();
      let i = 0;
      for (const m of mediaMsgs) {
        i += 1;
        if (onProgress) onProgress(`下载媒体 ${i}/${mediaMsgs.length}`, i, mediaMsgs.length);
        m.mediaMissing = false; m.mediaError = '';
        let result = null;
        let error = '';
        try {
          if (!m.id) throw new Error('消息缺少 ID');
          result = await WABridge.downloadMedia(m.id);
        } catch (e) {
          result = null;
          error = String(e.message || e);
        }
        const blob = this.mediaResultToBlob(result, m.mimetype);
        // Keep one filename for both MD links and ZIP entry
        let name = mediaFilename(m, i, blob?.type);
        const initial = name;
        let suffix = 2;
        while (used.has(name.toLowerCase())) {
          const dot = initial.lastIndexOf('.');
          name = `${dot > 0 ? initial.slice(0, dot) : initial}_${suffix++}${dot > 0 ? initial.slice(dot) : ''}`;
        }
        used.add(name.toLowerCase());
        m.exportFilename = name;
        m.exportMimetype = blob?.type || m.mimetype || '';
        if (!blob || blob.size === 0) {
          m.mediaMissing = true;
          m.mediaError = error || '媒体不可用或下载内容为空';
          files.push({ filename: name, blob: null, missing: true, messageId: m.id, error: m.mediaError, isAudio: mediaKindLabel(m) === 'audio' });
          if (onProgress) onProgress(`⚠ ${mediaKindLabel(m) === 'audio' ? '语音/音频' : '媒体'}下载失败：${name}`);
          continue;
        }
        files.push({ filename: name, blob, messageId: m.id, isAudio: mediaKindLabel(m) === 'audio' });
      }
      return files;
    },

    safeDownload(blob, filename, results, chatName, extra) {
      try {
        downloadBlob(blob, filename);
        results.push({ chat: chatName, file: filename, ...(extra || {}) });
        return true;
      } catch (e) {
        results.push({
          chat: chatName,
          file: null,
          messages: (extra && extra.messages) || 0,
          error: "下载失败: " + e,
        });
        return false;
      }
    },

    /**
     * Export one or more chats via WPP — ONE chat per bridge call.
     */
    async exportChats(chats, opts, onProgress) {
      const formats = opts.formats || ["md", "zip"];
      const includeMedia = opts.includeMedia !== false;
      const results = [];

      if (onProgress) onProgress("等待 WPP 就绪…");
      const ok = await WABridge.waitReady(opts.readyTimeoutMs || 25000);
      if (!ok) {
        results.push({
          chat: "-",
          file: null,
          messages: 0,
          error: "WPP 未就绪：请确认已登录 WhatsApp Web 并刷新页面后重试",
        });
        return results;
      }

      for (let ci = 0; ci < chats.length; ci++) {
        const chat = chats[ci];
        const label = `[${ci + 1}/${chats.length}] ${chat.name || chat.id}`;
        if (onProgress) onProgress(`${label}: 读取消息…`);

        let bundle;
        try {
          const list = await WABridge.getMessagesForChat(chat, -1, 120000);
          bundle = list && list[0];
        } catch (e) {
          results.push({
            chat: chat.name || chat.id,
            file: null,
            messages: 0,
            error: "getMessages 失败: " + e,
          });
          continue;
        }

        if (!bundle || !bundle.items || !bundle.items.length) {
          results.push({
            chat: chat.name || chat.id,
            file: null,
            messages: 0,
            error: "WPP 返回空消息（该聊天可能无历史或 id 无效）",
          });
          continue;
        }

        const chatMeta = {
          title: bundle.chatName || chat.name,
          chatId: bundle.chatId || chat.id,
          id: bundle.chatId || chat.id,
          phone: chat.phone || "",
        };

        // Real WhatsApp number for filename (jid @lid is not a phone)
        if (!chatMeta.phone) {
          try {
            const info = await WABridge.getContactInfo(chatMeta.chatId || chatMeta.id);
            if (info) {
              chatMeta.phone = info.phone || "";
              if (info.name && (!chatMeta.title || chatMeta.title === chatMeta.chatId)) {
                chatMeta.title = info.name;
              }
            }
          } catch {
            /* ignore */
          }
        }

        const rawCount = bundle.items.length;
        let messages = dedupeMessages(bundle.items);
        // Stamp 1:1 incoming names with chat identity (avoid LID in bubbles)
        const peerName = chatMeta.title || chat.name || "";
        const peerPhone = chatMeta.phone || chat.phone || bundle.phone || "";
        messages = messages.map((m) => {
          if (m.fromMe) return m;
          const lidName = looksLikeLid(m.displayName) || looksLikeLid(m.formattedName);
          const lidPhone = looksLikeLid(m.phone);
          if (!lidName && !lidPhone && m.displayName) return m;
          const label = peerName && !looksLikeLid(peerName) ? peerName : peerPhone;
          if (!label) return m;
          return {
            ...m,
            displayName: label,
            formattedName: label,
            phone: looksLikeLid(m.phone) ? peerPhone || "" : m.phone || peerPhone || "",
          };
        });
        const dupes = rawCount - messages.length;
        if (dupes > 0 && onProgress) {
          onProgress(`${label}: 去重 ${dupes} 条`);
        }
        const base = exportBaseName(chatMeta.title, chatMeta.chatId || chatMeta.id || chat.id, chatMeta.phone);
        const stamp = new Date().toISOString().slice(0, 10);

        let mediaFiles = [];
        if (includeMedia) {
          if (onProgress) onProgress(`${label}: 下载媒体…`);
          mediaFiles = await this.fetchMediaForMessages(messages, (msg) => {
            if (onProgress) onProgress(`${label}: ${msg}`);
          });
        } else {
          messages = messages.map((m) => ({
            ...m,
            isMedia: false,
            _rawHasMedia: false,
          }));
        }

        const mediaMap = new Map();
        for (const f of mediaFiles) {
          if (f.blob) mediaMap.set(f.filename, f.blob);
        }
        const mediaStats = {
          media: mediaFiles.filter(f => f.blob).length,
          audio: mediaFiles.filter(f => f.blob && f.isAudio).length,
          missingMedia: mediaFiles.filter(f => f.missing).length,
          missingAudio: mediaFiles.filter(f => f.missing && f.isAudio).length,
        };

        // Header avatar for HTML (name · WhatsApp)
        if (onProgress) onProgress(`${label}: 获取头像…`);
        const avatarDataURL = await fetchAvatarDataURL(chatMeta.chatId || chatMeta.id || chat.id);

        // Standalone HTML (clickable media when embed possible)
        if (formats.includes("html")) {
          const html = await toHtml(chatMeta, messages, {
            mediaMode: mediaMap.size ? "embed" : "none",
            mediaMap,
            avatarDataURL,
          });
          this.safeDownload(
            new Blob([html], { type: "text/html;charset=utf-8" }),
            `${base}_${stamp}.html`,
            results,
            chatMeta.title,
            { messages: messages.length, ...mediaStats }
          );
        }

        if (formats.includes("md")) {
          const md = this.toMarkdown(chatMeta, messages, { mediaMode: "names" });
          this.safeDownload(
            new Blob([md], { type: "text/markdown;charset=utf-8" }),
            `${base}_${stamp}.md`,
            results,
            chatMeta.title,
            { messages: messages.length }
          );
        }

        if (formats.includes("txt")) {
          this.safeDownload(
            new Blob([this.toTxt(chatMeta, messages)], { type: "text/plain;charset=utf-8" }),
            `${base}_${stamp}.txt`,
            results,
            chatMeta.title,
            { messages: messages.length }
          );
        }

        if (formats.includes("json")) {
          this.safeDownload(
            new Blob([this.toJson(chatMeta, messages)], { type: "application/json" }),
            `${base}_${stamp}.json`,
            results,
            chatMeta.title,
            { messages: messages.length }
          );
        }

        if (formats.includes("zip")) {
          try {
            const zipBlob = await this.toZip(chatMeta, messages, mediaFiles, (msg) => {
              if (onProgress) onProgress(`${label}: ${msg}`);
            }, { avatarDataURL });
            this.safeDownload(
              zipBlob,
              `${base}_${stamp}_backup.zip`,
              results,
              chatMeta.title,
              {
                messages: messages.length,
                ...mediaStats,
              }
            );
          } catch (e) {
            results.push({
              chat: chatMeta.title,
              file: null,
              messages: messages.length,
              error: "ZIP 失败: " + e,
            });
          }
        }
      }

      return results;
    },
  };

  global.WAExporter = WAExporter;
})(typeof self !== "undefined" ? self : globalThis);
