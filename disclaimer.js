(() => {
  const buttons = document.querySelectorAll('[data-language]');
  const sections = document.querySelectorAll('[data-content]');
  function selectLanguage(language) {
    const selected = language === 'en' ? 'en' : 'zh';
    document.documentElement.lang = selected === 'en' ? 'en' : 'zh-CN';
    sections.forEach(section => { section.hidden = section.dataset.content !== selected; });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === selected)));
    try { localStorage.setItem('wa-assistant-disclaimer-language', selected); } catch { /* Storage may be disabled. */ }
  }
  buttons.forEach(button => button.addEventListener('click', () => selectLanguage(button.dataset.language)));
  let saved = 'zh';
  try { saved = localStorage.getItem('wa-assistant-disclaimer-language') || 'zh'; } catch { /* Default to Chinese. */ }
  selectLanguage(saved);
})();
