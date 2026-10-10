/**
 * Content-script side of the WPP CustomEvent bridge.
 * Request: WABK_wpp {eventName, params, requestId}
 * Response: WABK_wpp_result {requestId, eventName, ok, data, error}
 */
(function (global) {
  "use strict";

  let injectTried = false;
  let reqSeq = 0;

  const WABridge = {
    isInjected() {
      return injectTried;
    },

    inject() {
      if (injectTried) return;
      injectTried = true;

      const load = (src, id) =>
        new Promise((resolve) => {
          if (document.getElementById(id)) return resolve(true);
          const s = document.createElement("script");
          s.id = id;
          s.src = chrome.runtime.getURL(src);
          s.onload = () => {
            s.remove();
            resolve(true);
          };
          s.onerror = () => {
            s.remove();
            resolve(false);
          };
          (document.head || document.documentElement).appendChild(s);
        });

      (async () => {
        const a = await load("libs/wppconnect-wa.js", "wabk-wpp-lib");
        if (!a) {
          console.warn("[WABK] failed to load wppconnect-wa.js");
          injectTried = false; // allow retry
          return;
        }
        const b = await load("injected.js", "wabk-wpp-bridge");
        if (!b) {
          console.warn("[WABK] failed to load injected.js");
          injectTried = false;
          return;
        }
        console.info("[WABK] inject ok");
      })();
    },

    /**
     * Call injected bridge with request correlation.
     */
    call(eventName, params = {}, timeoutMs = 30000) {
      this.inject();
      return new Promise((resolve, reject) => {
        const requestId = "wabk_" + Date.now().toString(36) + "_" + ++reqSeq;
        const timer = setTimeout(() => {
          window.removeEventListener("WABK_wpp_result", onResult);
          reject(new Error("WPP bridge timeout: " + eventName + " (" + timeoutMs + "ms)"));
        }, timeoutMs);

        function onResult(e) {
          const d = e.detail || {};
          if (d.requestId !== requestId) return;
          clearTimeout(timer);
          window.removeEventListener("WABK_wpp_result", onResult);
          if (!d.ok) {
            reject(new Error(d.error || eventName + " failed"));
            return;
          }
          resolve(d.data);
        }

        window.addEventListener("WABK_wpp_result", onResult);
        window.dispatchEvent(
          new CustomEvent("WABK_wpp", { detail: { eventName, params, requestId } })
        );
      });
    },

    async isMainReady(timeoutMs = 3000) {
      try {
        return !!(await this.call("isMainReady", {}, timeoutMs));
      } catch {
        return false;
      }
    },

    async waitReady(maxWaitMs = 25000) {
      this.inject();
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        try {
          await this.call("keepAlive", {}, 2000);
        } catch {
          /* ignore */
        }
        if (await this.isMainReady(2000)) return true;
        await new Promise((r) => setTimeout(r, 800));
      }
      return false;
    },

    getChatList(timeoutMs = 15000) {
      return this.call("getChatList", {}, timeoutMs);
    },

    getContactInfo(chatId, timeoutMs = 10000) {
      return this.call("getContactInfo", { chatId }, timeoutMs);
    },

    getActiveChat(timeoutMs = 8000) {
      return this.call("getActiveChat", {}, timeoutMs);
    },

    /** Fetch messages for ONE chat (long timeout for full history). */
    getMessagesForChat(chat, count = -1, timeoutMs = 120000) {
      return this.call("getMessages", { chats: [chat], count }, timeoutMs);
    },

    downloadMedia(id, timeoutMs = 60000) {
      return this.call("downloadMedia", { id }, timeoutMs);
    },

    getProfilePicture(chatId, timeoutMs = 10000) {
      return this.call("getProfilePicture", { chatId }, timeoutMs);
    },
  };

  global.WABridge = WABridge;
})(typeof self !== "undefined" ? self : globalThis);
