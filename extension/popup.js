const SHORTCUTS = [
  { key: 'shift', label: '⇧ Shift',  combo: '⌘ Shift+V' },
  { key: 'alt',   label: '⌥ Option', combo: '⌘ Option+V' },
  { key: 'ctrl',  label: '⌃ Ctrl',   combo: '⌃ Ctrl+V' },
];

const TIPS = [
  'JWT-токени залишаються активними навіть після вставки в AI — одразу відкликайте їх у консолі.',
  'DOCX-файли можуть містити PII у метаданих та прихованих коментарях, які не видно на екрані.',
  'IP-адреси внутрішньої мережі розкривають архітектуру інфраструктури — завжди маскуйте їх.',
  'Email у логах ідентифікують реальних користувачів. Замінюйте перед відправкою в AI.',
  'AWS-ключі у промптах можуть потрапити в логи провайдера — використовуйте IAM з мінімальними правами.',
  'Паспортні дані та ІПН мають найвищий рівень захисту — ніколи не вставляйте без редагування.',
  'Телефонні номери в промптах зберігаються в историї чату — перевіряйте налаштування конфіденційності.',
];

let settings = { mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false };

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
  el.textContent = 'Збережено ✓';
  setTimeout(() => { el.textContent = ''; }, 1200);
}

chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false }, (s) => {
  settings = s;
  render();
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
    document.getElementById('api-key-status').textContent = '✓ Ключ збережено';
    document.getElementById('api-key-status').style.color = '#4caf50';
  }
});

document.getElementById('api-key-save').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key || key === '••••••••••••••••••••') return;
  chrome.storage.local.set({ anthropicKey: key }, () => {
    document.getElementById('api-key-input').value = '';
    document.getElementById('api-key-input').placeholder = '••••••••••••••••••••';
    document.getElementById('api-key-status').textContent = '✓ Збережено';
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
    el.textContent = '⏳ Генеруємо пораду…';
    try {
      const types = [...new Set(lastPiiTypes)].slice(0, 3);
      const ctx = types.length ? `Нещодавно знайдені типи PII: ${types.join(', ')}. ` : '';
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          messages: [{ role: 'user', content: `${ctx}Дай одну коротку конкретну пораду з кібербезпеки (1–2 речення, без вступу, українською).` }],
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
  const idx = (lastType && typeMap[lastType] !== undefined) ? typeMap[lastType] : new Date().getDay() % TIPS.length;
  el.textContent = TIPS[idx];
}

loadTip();

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
