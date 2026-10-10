/**
 * Injected UI: toolbar button + panel. Chat list via WPP bridge.
 */
(function (global) {
  "use strict";

  const STATE = {
    open: false,
    chats: [],
    selected: new Set(),
    busy: false,
    progress: "",
    // Default: ZIP only (contains chat.md + chat.html + media) to avoid duplicate downloads
    formats: { html: false, md: false, zip: true, txt: false, json: false },
    includeMedia: true,
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  const WAUI = {
    state: STATE,
    panel: null,
    toolbarBtn: null,
    floatBtn: null,

    /** Two fixed entry points: (1) chat header action bar (2) floating edge button */
    ensureToolbarButton() {
      this.ensureHeaderButton();
      this.ensureFloatingButton();
    },

    ensureHeaderButton() {
      if (this.toolbarBtn && document.contains(this.toolbarBtn)) return;
      // ONLY inject into the conversation header inside #main.
      // Never fall back to page-level <header> — that can hit the left nav / app chrome
      // and collapse WhatsApp's sidebar.
      const header = document.querySelector("#main header");
      if (!header) return;
      const hr = header.getBoundingClientRect();
      if (hr.width < 80 || hr.height < 20) return;

      const btn = el("button", {
        type: "button",
        class: "wabk-toolbar-btn wabk-green wabk-header-btn",
        id: "wabk-header-btn",
        title: "WA Chats Backup Pro — 打开面板",
        "aria-label": "WA Chats Backup Pro",
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.togglePanel();
        },
      });
      btn.innerHTML = `<span class="wabk-icon"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.6z"/></svg></span>`;
      try {
        // Absolutely positioned inside #main header — does not restructure WA icon clusters
        header.style.position = header.style.position || "relative";
        header.appendChild(btn);
      } catch {
        /* ignore */
      }
      this.toolbarBtn = btn;
    },

    ensureFloatingButton() {
      if (this.floatBtn && document.contains(this.floatBtn)) return;
      const btn = el("button", {
        type: "button",
        class: "wabk-float-btn",
        id: "wabk-float-btn",
        title: "WA Chats Backup Pro",
        "aria-label": "WA Chats Backup Pro",
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.togglePanel();
        },
      });
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm.5-13H11v6l5.2 3.1.8-1.3-4.5-2.6z"/></svg>`;
      document.body.appendChild(btn);
      this.floatBtn = btn;
    },

    buildPanel() {
      if (this.panel && document.contains(this.panel)) return this.panel;
      const panel = el("aside", { class: "wabk-panel", id: "wabk-panel", "data-open": "false" });
      panel.innerHTML = `
        <div class="wabk-header">
          <div class="wabk-title">
            <span class="wabk-brand">WA Chats Backup</span>
            <span class="wabk-badge">WPP</span>
          </div>
          <button type="button" class="wabk-close" title="关闭" aria-label="Close">×</button>
        </div>
        <div class="wabk-banner">
          通过 <b>WPPConnect Store</b> 读取消息（与 Chats Backup for wa 同架构）。请先登录 WhatsApp Web 并刷新页面。
        </div>
        <div class="wabk-body">
          <section class="wabk-col wabk-chats">
            <div class="wabk-section-title">选择聊天 <small>（可多选）</small></div>
            <div class="wabk-chat-list" id="wabk-chat-list"></div>
            <div class="wabk-list-actions">
              <button type="button" data-act="active">当前聊天</button>
              <button type="button" data-act="all">全选</button>
              <button type="button" data-act="none">清空</button>
              <button type="button" data-act="refresh">刷新</button>
            </div>
            <p class="wabk-hint">💡 列表为空时点「刷新」，或 F5 后再试。</p>
          </section>
          <section class="wabk-col wabk-options">
            <div class="wabk-section-title">导出格式</div>
            <div class="wabk-formats">
              <label><input type="checkbox" name="fmt" value="zip" checked> ZIP（推荐：md + html + 媒体）</label>
              <label><input type="checkbox" name="fmt" value="html"> 单独 HTML（可点击媒体）</label>
              <label><input type="checkbox" name="fmt" value="md"> 单独 Markdown</label>
              <label><input type="checkbox" name="fmt" value="txt"> TXT</label>
              <label><input type="checkbox" name="fmt" value="json"> JSON</label>
            </div>
            <p class="wabk-hint">默认只下 ZIP，避免和 ZIP 内文件重复。勾选「单独 HTML/MD」才会额外多下一个文件。</p>
            <div class="wabk-toggles">
              <label><input type="checkbox" id="wabk-media" checked> 包含图片、视频、语音/音频及文件</label>
              <p class="wabk-hint">ZIP 保存语音文件；单独 HTML 可直接播放。MD/TXT/JSON 单独导出不包含音频文件本体。</p>
            </div>
            <button type="button" class="wabk-export-btn" id="wabk-export">导出所选</button>
            <button type="button" class="wabk-export-btn ghost" id="wabk-export-active">导出当前聊天</button>
            <button type="button" class="wabk-export-btn ghost" id="wabk-diag">诊断 WPP</button>
            <div class="wabk-progress" id="wabk-progress" hidden></div>
            <div class="wabk-log" id="wabk-log"></div>
          </section>
        </div>
      `;
      document.body.appendChild(panel);
      panel.inert = true;
      panel.querySelector(".wabk-close").addEventListener("click", () => this.setOpen(false));
      panel.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", () => this.listAction(btn.getAttribute("data-act")));
      });
      panel.querySelectorAll('input[name="fmt"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          STATE.formats[cb.value] = cb.checked;
        });
      });
      panel.querySelector("#wabk-media").addEventListener("change", (e) => {
        STATE.includeMedia = e.target.checked;
      });
      panel.querySelector("#wabk-export").addEventListener("click", () => this.startExport(false));
      panel.querySelector("#wabk-export-active").addEventListener("click", () => this.startExport(true));
      panel.querySelector("#wabk-diag").addEventListener("click", () => this.runDiagnose());
      this.panel = panel;
      return panel;
    },

    setOpen(open) {
      const wasOpen = STATE.open;
      if (open && !wasOpen) this.returnFocus = document.activeElement;
      STATE.open = open;
      const panel = this.buildPanel();
      panel.setAttribute("data-open", open ? "true" : "false");
      panel.inert = !open;
      if (open && !wasOpen) panel.querySelector('.wabk-close').focus({ preventScroll: true });
      if (!open && wasOpen && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
      if (open) {
        // Lazy-load WPP only when user actually needs it
        WABridge.inject();
        this.refreshChats();
      }
    },

    togglePanel() {
      this.setOpen(!STATE.open);
    },

    listAction(act) {
      if (act === "refresh") return this.refreshChats();
      if (act === "none") {
        STATE.selected.clear();
        return this.renderChatList();
      }
      if (act === "all") {
        STATE.chats.forEach((c) => STATE.selected.add(c.id));
        return this.renderChatList();
      }
      if (act === "active") {
        WABridge.getActiveChat()
          .then((c) => {
            if (c && c.id) {
              STATE.selected.clear();
              STATE.selected.add(c.id);
              if (!STATE.chats.some((x) => x.id === c.id)) {
                STATE.chats.unshift({ id: c.id, name: c.name || c.id });
              }
            }
            this.renderChatList();
          })
          .catch((e) => this.log("getActiveChat: " + e));
      }
    },

    async refreshChats() {
      this.setProgress("等待 WPP…");
      const ok = await WABridge.waitReady(20000);
      if (!ok) {
        this.setProgress("WPP 未就绪");
        this.log("WPP 未就绪。请：1) 已登录 WhatsApp 2) F5 刷新 3) 再点刷新");
        return;
      }
      this.setProgress("读取聊天列表…");
      try {
        const list = await WABridge.getChatList();
        const seen = new Set();
        STATE.chats = (Array.isArray(list) ? list : []).filter((c) => {
          const key = c.id || c.name;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        this.renderChatList();
        this.setProgress("");
        this.log(`加载 ${STATE.chats.length} 个聊天`);
      } catch (e) {
        this.setProgress("列表失败");
        this.log(String(e));
      }
    },

    renderChatList() {
      const list = document.getElementById("wabk-chat-list");
      if (!list) return;
      list.innerHTML = "";
      if (!STATE.chats.length) {
        list.appendChild(el("div", { class: "wabk-empty", text: "未找到聊天。点刷新或刷新 WhatsApp 页面。" }));
        return;
      }
      for (const chat of STATE.chats) {
        const selected = STATE.selected.has(chat.id);
        const row = el("div", {
          class: `wabk-chat-row${selected ? " selected" : ""}`,
          onclick: () => {
            if (STATE.selected.has(chat.id)) STATE.selected.delete(chat.id);
            else STATE.selected.add(chat.id);
            this.renderChatList();
          },
        });
        row.innerHTML = `<span class="wabk-radio"></span><span class="wabk-chat-title" title="${String(chat.name || "").replace(/"/g, "&quot;")}">${escapeHtml(chat.name || chat.id)}</span>`;
        list.appendChild(row);
      }
    },

    log(msg) {
      const box = this.panel?.querySelector("#wabk-log");
      if (!box) return;
      box.prepend(el("div", { class: "wabk-log-line", text: msg }));
      while (box.children.length > 40) box.lastChild.remove();
    },

    setProgress(msg) {
      const p = this.panel?.querySelector("#wabk-progress");
      if (!p) return;
      if (!msg) {
        p.hidden = true;
        p.textContent = "";
      } else {
        p.hidden = false;
        p.textContent = msg;
      }
    },

    async runDiagnose() {
      this.log("—— 诊断 ——");
      WABridge.inject();
      this.log("已尝试注入 wppconnect + bridge");
      const ok = await WABridge.waitReady(20000);
      this.log("isMainReady: " + ok);
      if (!ok) {
        this.log("WPP 未就绪。请刷新 WhatsApp Web（F5）后重试。");
        return;
      }
      try {
        const list = await WABridge.getChatList();
        this.log("聊天列表: " + (list ? list.length : 0));
        const active = await WABridge.getActiveChat();
        this.log("当前聊天: " + (active ? active.name + " / " + active.id : "无"));
        if (list && list.length) {
          const sample = list[0];
          const msgs = await WABridge.getMessagesForChat({ id: sample.id, name: sample.name }, 5, 30000);
          const n = msgs && msgs[0] && msgs[0].items ? msgs[0].items.length : 0;
          this.log(`样例聊天「${sample.name}」取 5 条 → 实际 ${n} 条`);
          if (n) {
            const m = msgs[0].items[msgs[0].items.length - 1];
            this.log(`  最后: [${m.fromMe ? "我" : m.displayName}] ${(m.message || m.caption || m.type || "").slice(0, 60)}`);
          }
        }
      } catch (e) {
        this.log("诊断异常: " + e);
      }
    },

    async startExport(onlyActive) {
      if (STATE.busy) return;
      let targets = [];
      if (onlyActive) {
        const c = await WABridge.getActiveChat().catch(() => null);
        if (c && c.id) targets = [c];
        else {
          this.log("拿不到当前聊天，请先点开一个会话");
          this.setProgress("无当前聊天");
          return;
        }
      } else {
        targets = STATE.chats.filter((c) => STATE.selected.has(c.id));
      }
      if (!targets.length) {
        this.log("请至少选择一个聊天");
        this.setProgress("未选择聊天");
        return;
      }
      const formats = Object.keys(STATE.formats).filter((k) => STATE.formats[k]);
      if (!formats.length) {
        this.log("请选择导出格式");
        return;
      }

      STATE.busy = true;
      const exportBtn = this.panel.querySelector("#wabk-export");
      exportBtn.disabled = true;
      exportBtn.textContent = "导出中…";
      try {
        this.setProgress(`导出 ${targets.length} 个聊天…`);
        const results = await WAExporter.exportChats(
          targets,
          { formats, includeMedia: STATE.includeMedia },
          (msg) => {
            this.setProgress(msg);
            this.log(msg);
          }
        );
        this.log(`完成 ${results.length} 项`);
        for (const r of results) {
          if (r.error) this.log(`✗ ${r.chat}: ${r.error}`);
          else {
            this.log(`✓ ${r.file}（${r.messages} 条${r.media != null ? "，媒体 " + r.media : ""}${r.audio != null ? "，语音/音频 " + r.audio : ""}）`);
            if (r.missingMedia) this.log(`⚠ ${r.missingMedia} 个媒体未下载成功，含语音/音频 ${r.missingAudio || 0} 个；请查看导出中的失败提示。`);
          }
        }
        this.setProgress(results.every((r) => !r.file) ? "导出失败" : "完成");
      } catch (err) {
        console.error(err);
        this.setProgress("错误: " + err);
        this.log(String(err));
      } finally {
        STATE.busy = false;
        exportBtn.disabled = false;
        exportBtn.textContent = "导出所选";
        setTimeout(() => this.setProgress(""), 5000);
      }
    },
  };

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  global.WAUI = WAUI;
})(typeof self !== "undefined" ? self : globalThis);
