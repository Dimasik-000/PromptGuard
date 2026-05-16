const SHORTCUTS = [
  { key: 'shift', label: '⇧ Shift',  combo: '⌘ Shift+V' },
  { key: 'alt',   label: '⌥ Option', combo: '⌘ Option+V' },
  { key: 'ctrl',  label: '⌃ Ctrl',   combo: '⌃ Ctrl+V' },
];

const STRINGS = {
  uk: {
    modeLabel:      'Режим роботи',
    modeModal:      'Показувати вікно',
    modeModalDesc:  'Підтвердити перед відправкою',
    modeAuto:       'Авто-заміна',
    modeAutoDesc:   'Замінити PII без підтвердження',
    bypassLabel:    'Bypass клавіша',
    bypassHint:     'Тримай + V щоб вставити без сканування',
    docsLabel:      'Документи',
    docRegexTitle:  'Виявлення чутливих даних',
    docRegexDesc:   'Швидке сканування за шаблонами (email, телефон, ІПН…)',
    docAiTitle:     'Виявлення чутливих даних',
    docAiDesc:      'Глибокий аналіз через Claude API',
    docRedactTitle: 'Заміна даних в документі',
    docRedactDesc:  'Редагувати PII та завантажити очищений файл',
    extLabel:       'Розширення',
    extActive:      'Активне',
    pageLabel:      'Сторінка',
    pageTitle:      'Замінювати PII на поточному сайті',
    pageDesc:       'Приховати дані прямо в тексті сторінки',
    statsLabel:     'Статистика',
    statPaste:      'PII в текстах',
    statDoc:        'PII в документах',
    tipLabel:       '💡 ПОРАДА',
    saved:          'Збережено ✓',
    keySaved:       '✓ Ключ збережено',
    keySaving:      '✓ Збережено',
    generating:     '⏳ Генеруємо пораду…',
    tipPrompt:      'Дай одну коротку конкретну пораду з кібербезпеки (1–2 речення, без вступу, українською).',
    tipCtxPrefix:   'Нещодавно знайдені типи PII: ',
  },
  en: {
    modeLabel:      'Mode',
    modeModal:      'Show dialog',
    modeModalDesc:  'Confirm before sending',
    modeAuto:       'Auto-replace',
    modeAutoDesc:   'Replace PII without confirmation',
    bypassLabel:    'Bypass key',
    bypassHint:     'Hold + V to paste without scanning',
    docsLabel:      'Documents',
    docRegexTitle:  'Sensitive data detection',
    docRegexDesc:   'Fast pattern scan (email, phone, SSN…)',
    docAiTitle:     'Sensitive data detection',
    docAiDesc:      'Deep analysis via Claude API',
    docRedactTitle: 'Redact document',
    docRedactDesc:  'Edit PII and download clean file',
    extLabel:       'Extension',
    extActive:      'Active',
    pageLabel:      'Page',
    pageTitle:      'Replace PII on current site',
    pageDesc:       'Hide data directly in page text',
    statsLabel:     'Statistics',
    statPaste:      'PII in texts',
    statDoc:        'PII in documents',
    tipLabel:       '💡 TIP',
    saved:          'Saved ✓',
    keySaved:       '✓ Key saved',
    keySaving:      '✓ Saved',
    generating:     '⏳ Generating tip…',
    tipPrompt:      'Give one short specific cybersecurity tip (1–2 sentences, no intro, in English).',
    tipCtxPrefix:   'Recently found PII types: ',
  },
};

const TIPS = {
  uk: [
    'JWT-токени залишаються активними навіть після вставки в AI — одразу відкликайте їх у консолі.',
    'DOCX-файли можуть містити PII у метаданих та прихованих коментарях, які не видно на екрані.',
    'IP-адреси внутрішньої мережі розкривають архітектуру інфраструктури — завжди маскуйте їх.',
    'Email у логах ідентифікують реальних користувачів. Замінюйте перед відправкою в AI.',
    'AWS-ключі у промптах можуть потрапити в логи провайдера — використовуйте IAM з мінімальними правами.',
    'Паспортні дані та ІПН мають найвищий рівень захисту — ніколи не вставляйте без редагування.',
    'Телефонні номери в промптах зберігаються в историї чату — перевіряйте налаштування конфіденційності.',
  ],
  en: [
    'JWT tokens remain active even after pasting into AI — revoke them immediately in your console.',
    'DOCX files may contain PII in metadata and hidden comments not visible on screen.',
    'Internal IP addresses reveal infrastructure architecture — always mask them.',
    'Emails in logs identify real users. Replace them before sending to AI.',
    'AWS keys in prompts can end up in provider logs — use IAM with least privilege.',
    'Passport data and tax IDs have the highest protection level — never paste without editing.',
    'Phone numbers in prompts are stored in chat history — check your privacy settings.',
  ],
};

let lang = 'uk';
let settings = { mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false, lang: 'uk' };

function applyLang(l) {
  lang = l;
  const s = STRINGS[l] || STRINGS.uk;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (s[key] !== undefined) el.textContent = s[key];
  });
  document.getElementById('lang-uk').className = 'lang-btn' + (l === 'uk' ? ' active' : '');
  document.getElementById('lang-en').className = 'lang-btn' + (l === 'en' ? ' active' : '');
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.sync.set(settings, () => {
    flash();
    render();
  });
}

function render() {
  ['modal', 'auto'].forEach(m => {
    document.getElementById(`opt-${m}`).className = 'option' + (settings.mode === m ? ' active' : '');
    document.getElementById(`radio-${m}`).className = 'radio' + (settings.mode === m ? ' checked' : '');
  });
  document.getElementById('enabled-toggle').checked = settings.enabled;
  document.getElementById('doc-regex-toggle').checked = settings.docRegex;
  document.getElementById('doc-ai-toggle').checked = settings.docAi;
  document.getElementById('doc-redact-toggle').checked = settings.docRedact;
  document.getElementById('page-replace-toggle').checked = settings.pageReplace;
  document.getElementById('api-key-row').style.display = settings.docAi ? 'block' : 'none';
  buildShortcuts();
}

function buildShortcuts() {
  const sec = document.getElementById('shortcut-section');
  sec.innerHTML = '';
  for (const sc of SHORTCUTS) {
    const row = document.createElement('div');
    row.className = 'sc-row' + (settings.shortcut === sc.key ? ' active' : '');
    row.innerHTML = `<span style="font-size:13px">${sc.label}</span><kbd>${sc.combo}</kbd>`;
    row.addEventListener('click', () => save({ shortcut: sc.key }));
    sec.appendChild(row);
  }
}

function flash() {
  const el = document.getElementById('status');
  el.textContent = STRINGS[lang].saved;
  setTimeout(() => { el.textContent = ''; }, 1200);
}

chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false, lang: 'uk' }, (s) => {
  settings = s;
  lang = s.lang || 'uk';
  render();
  applyLang(lang);
});

// Stats
chrome.storage.local.get({ pasteRedacted: 0, docRedacted: 0 }, (s) => {
  document.getElementById('stat-paste').textContent = s.pasteRedacted;
  document.getElementById('stat-doc').textContent   = s.docRedacted;
});

// API key: load status
chrome.storage.local.get({ anthropicKey: '' }, (s) => {
  if (s.anthropicKey) {
    document.getElementById('api-key-input').placeholder = '••••••••••••••••••••';
    document.getElementById('api-key-status').textContent = STRINGS[lang].keySaved;
    document.getElementById('api-key-status').style.color = '#4caf50';
  }
});

document.getElementById('api-key-save').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key || key === '••••••••••••••••••••') return;
  chrome.storage.local.set({ anthropicKey: key }, () => {
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-key-input').placeholder = '••••••••••••••••••••';
    document.getElementById('api-key-status').textContent = STRINGS[lang].keySaving;
    document.getElementById('api-key-status').style.color = '#4caf50';
    loadTip();
  });
});

// Dynamic AI tip
async function loadTip() {
  const el = document.getElementById('ai-tip');
  const { anthropicKey, lastPiiTypes } = await new Promise(r =>
    chrome.storage.local.get({ anthropicKey: '', lastPiiTypes: [] }, r)
  );

  if (anthropicKey) {
    el.textContent = STRINGS[lang].generating;
    try {
      const types = [...new Set(lastPiiTypes)].slice(0, 3);
      const str = STRINGS[lang];
      const ctx = types.length ? `${str.tipCtxPrefix}${types.join(', ')}. ` : '';
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          messages: [{ role: 'user', content: `${ctx}${str.tipPrompt}` }],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const tip = data.content?.[0]?.text?.trim();
        if (tip) { el.textContent = tip; return; }
      }
    } catch (_) {}
  }

  // Context-aware static fallback
  const typeMap = { 'Телефон': 6, 'JWT': 0, 'IP-адреса': 2, 'Email': 3, 'AWS Key': 4, 'Credit Card': 1, 'ІПН (UA)': 5 };
  const lastType = lastPiiTypes[0];
  const idx = (lastType && typeMap[lastType] !== undefined) ? typeMap[lastType] : new Date().getDay() % 7;
  el.textContent = TIPS[lang][idx];
}

loadTip();

document.getElementById('lang-uk').addEventListener('click', () => {
  if (lang === 'uk') return;
  lang = 'uk';
  chrome.storage.sync.set({ lang: 'uk' });
  applyLang('uk');
  loadTip();
});
document.getElementById('lang-en').addEventListener('click', () => {
  if (lang === 'en') return;
  lang = 'en';
  chrome.storage.sync.set({ lang: 'en' });
  applyLang('en');
  loadTip();
});

document.getElementById('opt-modal').addEventListener('click', () => save({ mode: 'modal' }));
document.getElementById('opt-auto').addEventListener('click', () => save({ mode: 'auto' }));
document.getElementById('enabled-toggle').addEventListener('change', (e) => save({ enabled: e.target.checked }));
document.getElementById('doc-regex-toggle').addEventListener('change', (e) => save({ docRegex: e.target.checked }));
document.getElementById('doc-ai-toggle').addEventListener('change', (e) => {
  save({ docAi: e.target.checked });
  document.getElementById('api-key-row').style.display = e.target.checked ? 'block' : 'none';
});
document.getElementById('doc-redact-toggle').addEventListener('change', (e) => save({ docRedact: e.target.checked }));
document.getElementById('page-replace-toggle').addEventListener('change', (e) => save({ pageReplace: e.target.checked }));
