/**
 * Bootstrap UI first. WPP library is injected only when user opens the panel
 * — avoids breaking WhatsApp layout (e.g. left nav) on page load.
 */
(function () {
  "use strict";
  if (window.__WABK_LOADED__) return;
  window.__WABK_LOADED__ = true;

  function boot() {
    // UI only — no WPP inject yet
    WAUI.ensureToolbarButton();
    WAUI.buildPanel();
    WAQuickReplies.init();

    // Throttled, scoped re-inject when conversation header appears/changes
    let timer = null;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        WAUI.ensureHeaderButton();
      }, 400);
    };

    const main = document.querySelector("#main") || document.body;
    const obs = new MutationObserver(schedule);
    obs.observe(main, { childList: true, subtree: false });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === "WABK_OPEN") {
        WAUI.setOpen(true);
        sendResponse({ ok: true, chats: WAUI.state.chats.length });
        return true;
      }
      if (msg.type === "WABK_EXPORT_ACTIVE") {
        WAUI.setOpen(true);
        WAUI.startExport(true).then(() => sendResponse({ ok: true }));
        return true;
      }
      if (msg.type === "WABK_STATUS") {
        WABridge.inject();
        WABridge.isMainReady().then((ready) => {
          sendResponse({
            ok: true,
            open: WAUI.state.open,
            chats: WAUI.state.chats.length,
            ready,
          });
        });
        return true;
      }
    });

    console.info("[WA Chats Backup Pro] UI ready (WPP lazy)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(boot, 500));
  } else {
    setTimeout(boot, 500);
  }
})();
