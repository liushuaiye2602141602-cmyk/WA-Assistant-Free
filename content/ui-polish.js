(function () {
  'use strict';
  const build = WAUI.buildPanel;
  WAUI.buildPanel = function () {
    const panel = build.call(this);
    if (panel.dataset.polished) return panel;
    panel.dataset.polished = 'true';
    panel.setAttribute('aria-label', 'WhatsApp 助手面板');
    const banner = panel.querySelector('.wabk-banner');
    if (banner) banner.textContent = '保存重要对话，也保存图片、视频和语音。选择聊天后，即可导出到电脑。';
    const nav = panel.querySelector('.waa-nav');
    nav.setAttribute('aria-label', '助手功能');
    const tabs = [...nav.querySelectorAll('[data-tab]')];
    function updateTabs() {
      tabs.forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    }
    nav.addEventListener('click', event => {
      updateTabs();
      if (event.target.closest('[data-tab]')) panel.querySelector('.waa-tools').scrollTop=0;
    });
    updateTabs();
    // Move existing nodes so their event handlers, IDs and form values stay intact.
    const send = panel.querySelector('[data-pane="send"]');
    const nodes = [...send.children];
    const boundaries = [
      [nodes.findIndex(n => n.id === 'waa-numbers'), '01', '添加收件人'],
      [nodes.findIndex(n => n.querySelector?.('#waa-templates')), '02', '编辑消息与附件'],
      [nodes.findIndex(n => n.querySelector?.('#waa-schedule')), '03', '发送设置与预览'],
      [nodes.findIndex(n => n.tagName === 'H3' && n.textContent.includes('报告')), '04', '任务与发送报告']
    ];
    boundaries.forEach(([start, number, title], i) => {
      if (start < 0) return;
      const end = boundaries[i + 1]?.[0] ?? nodes.length;
      const card = document.createElement('div'); card.className = 'waa-card';
      const heading = document.createElement('h4');
      const badge = document.createElement('span'); badge.textContent = number;
      heading.append(badge, document.createTextNode(title)); card.append(heading);
      send.append(card);
      nodes.slice(start, end).forEach(n => {
        if (n.tagName !== 'H3') card.append(n);
        else n.remove();
      });
    });
    const settingsCard = send.querySelectorAll('.waa-card')[2];
    const intervalRow = panel.querySelector('#waa-min').closest('.waa-row');
    settingsCard.querySelector('h4').after(intervalRow);
    const summary = panel.querySelector('#waa-recipient-summary');
    summary.dataset.emptyLabel = '尚未添加收件人，可读取号码或导入表格';
    const closePanel = this.setOpen.bind(this);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !document.querySelector('#waqr-manager:not([hidden])')) {
        event.preventDefault(); closePanel(false);
      }
    });
    for (const id of ['wabk-export', 'waa-add', 'waa-start', 'waa-contacts-load', 'waa-contacts-send']) {
      panel.querySelector('#' + id)?.classList.add('waa-primary');
    }
    panel.querySelector('#waa-stop')?.classList.add('waa-danger');
    panel.querySelector('#wabk-diag').textContent = '检查连接';
    panel.querySelector('.wabk-close').setAttribute('aria-label', '关闭助手面板');
    panel.querySelector('#waa-numbers').setAttribute('aria-label', '收件人号码');
    panel.querySelector('#waa-text').setAttribute('aria-label', '消息正文');
    panel.querySelector('#waa-template-name').setAttribute('aria-label', '模板名称');
    panel.querySelector('#waa-status').setAttribute('role', 'status');
    for (const id of ['waa-preview', 'waa-report']) {
      const block = panel.querySelector('#' + id);
      block.dataset.emptyLabel = id === 'waa-preview' ? '生成预览后，在这里核对消息内容' : '选择任务后，在这里查看发送结果';
    }
    return panel;
  };
})();
