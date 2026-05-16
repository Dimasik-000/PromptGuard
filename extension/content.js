console.log('[PromptGuard] loaded v2.0.0');

let settings = { mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false };

chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false }, (s) => {
  settings = s;
  console.log('[PromptGuard] settings:', settings);
  if (settings.pageReplace) applyPageReplace();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const key in changes) {
    settings[key] = changes[key].newValue;
    console.log('[PromptGuard] updated:', key, '->', changes[key].newValue);
  }
  if (changes.pageReplace?.newValue) applyPageReplace();
});

let lastInput = null;
document.addEventListener('focusin', (e) => {
  if (e.target.isContentEditable || e.target.tagName === 'TEXTAREA') {
    lastInput = e.target;
  }
});

document.addEventListener('paste', (e) => {
  const bypassMap = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey };
  if ((e.metaKey || e.ctrlKey) && bypassMap[settings.shortcut]) {
    console.log('[PromptGuard] bypass');
    return;
  }

  const text = e.clipboardData?.getData('text');
  if (!text || text.length < 3) return;

  if (!settings.enabled) {
    console.log('[PromptGuard] disabled');
    return;
  }

  const spans = regexScan(text);
  if (spans.length === 0) {
    console.log('[PromptGuard] no PII');
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const targetEl = lastInput || document.activeElement;
  const redacted = redact(text, spans);

  console.log('[PromptGuard] mode:', settings.mode, 'spans:', spans.length);

  if (settings.mode === 'auto') {
    insert(redacted, targetEl);
    showToast(`🛡️ ${spans.length} PII замінено`);
  } else {
    showModal(text, redacted, spans, targetEl, () => fireEnter(targetEl));
  }
}, true);

// ── Send-time scan (auto + modal mode: also scan text typed manually) ────────
let pgSending = false;

function fireEnter(el) {
  pgSending = true;
  setTimeout(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true, composed: true,
    }));
    pgSending = false;
  }, 80);
}

document.addEventListener('keydown', (e) => {
  if (pgSending) return;
  if (!settings.enabled) return;
  if (e.key !== 'Enter' || e.shiftKey) return;

  const el = lastInput || document.activeElement;
  if (!el || (!el.isContentEditable && el.tagName !== 'TEXTAREA')) return;

  const raw = el.isContentEditable ? (el.innerText || el.textContent || '') : el.value;
  if (raw.trim().length < 3) return;

  const spans = regexScan(raw);
  if (!spans.length) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const redacted = redact(raw, spans);

  if (settings.mode === 'auto') {
    insert(redacted, el);
    trackStats(spans.length, 'paste', spans.map(s => s.type));
    showToast(`🛡️ ${spans.length} PII замінено`);
    fireEnter(el);
  } else {
    showModal(raw, redacted, spans, el, () => fireEnter(el));
  }
}, true);

function regexScan(text) {
  const spans = [];
  const rules = [
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, 'EMAIL'],
    [/\+?[\d\s\-(). ]{7,15}\d/g, 'PHONE'],
    [/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, 'JWT'],
    [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP'],
    [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CC'],
  ];
  for (const [re, type] of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null)
      spans.push({ start: m.index, end: m.index + m[0].length, type });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function redact(text, spans) {
  let out = '', i = 0;
  for (const s of spans) {
    out += text.slice(i, s.start) + `[REDACTED_${s.type}]`;
    i = s.end;
  }
  return out + text.slice(i);
}

function insert(text, el) {
  el = el || document.activeElement;
  if (!el) return;
  if (el.isContentEditable) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    sel.deleteFromDocument();
    const node = document.createTextNode(text);
    const range2 = document.createRange();
    range2.setStart(el, 0);
    range2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range2);
    range2.insertNode(node);
    sel.collapseToEnd();
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1a1a1a;color:#f5a623;padding:10px 18px;border-radius:10px;font-family:system-ui;font-size:13px;z-index:2147483647;border:1px solid #f5a623;box-shadow:0 4px 20px rgba(0,0,0,.4);';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function showModal(original, redacted, spans, targetEl, onSend) {
  document.getElementById('pg-root')?.remove();
  const root = document.createElement('div');
  root.id = 'pg-root';
  const s = root.attachShadow({ mode: 'open' });
  s.innerHTML = `<style>
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center}
    .box{background:#1a1a1a;color:#eee;border-radius:14px;padding:24px;width:540px;max-width:90vw;font-family:system-ui;font-size:14px}
    h3{margin:0 0 14px;color:#f5a623}
    .lbl{color:#888;font-size:11px;margin-bottom:4px;text-transform:uppercase;display:flex;align-items:center;gap:6px}
    .lbl-hint{color:#555;font-size:10px;font-style:italic;text-transform:none}
    .txt{background:#2a2a2a;border-radius:8px;padding:12px;margin-bottom:14px;white-space:pre-wrap;line-height:1.6;word-break:break-word;max-height:130px;overflow-y:auto}
    .edit{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:12px;margin-bottom:14px;line-height:1.6;word-break:break-word;min-height:60px;max-height:140px;overflow-y:auto;width:100%;box-sizing:border-box;resize:vertical;color:#eee;font-family:system-ui;font-size:13px;}
    .edit:focus{outline:none;border-color:#f5a623;}
    .hi{color:#f5a623;font-weight:bold}
    .hint{font-size:11px;color:#555;text-align:right;margin-top:-10px;margin-bottom:10px}
    .btns{display:flex;gap:8px;justify-content:flex-end}
    button{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}
    .ok{background:#f5a623;color:#000}
    .orig{background:#333;color:#eee}
    .cancel{background:transparent;color:#888;border:1px solid #444}
  </style>
  <div class="ov"><div class="box">
    <h3>🛡️ PromptGuard — знайдено ${spans.length} PII</h3>
    <div class="lbl">Буде відправлено: <span class="lbl-hint">редагуйте за потреби</span></div>
    <textarea class="edit">${esc(redacted)}</textarea>
    <div class="lbl">Оригінал:</div>
    <div class="txt">${esc(original)}</div>
    <div class="hint">⌘ Shift+V — вставити без сканування</div>
    <div class="btns">
      <button class="cancel">Скасувати</button>
      <button class="orig">Оригінал</button>
      <button class="ok">✓ Відправити</button>
    </div>
  </div></div>`;
  s.querySelector('.ok').onclick = () => {
    const text = s.querySelector('.edit').value;
    trackStats(spans.length, 'paste', spans.map(s => s.type));
    root.remove();
    insert(text, targetEl);
    if (onSend) onSend();
  };
  s.querySelector('.orig').onclick = () => {
    root.remove();
    insert(original, targetEl);
    if (onSend) onSend();
  };
  s.querySelector('.cancel').onclick = () => root.remove();
  document.body.appendChild(root);
}

function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function hl(t) { return esc(t).replace(/\[REDACTED_\w+\]/g, m => `<span class="hi">${m}</span>`); }

function trackStats(count, type, piiTypes = []) {
  chrome.storage.local.get({ pasteRedacted: 0, docRedacted: 0 }, (s) => {
    const patch = type === 'paste'
      ? { pasteRedacted: s.pasteRedacted + count }
      : { docRedacted: s.docRedacted + count };
    if (piiTypes.length) patch.lastPiiTypes = piiTypes.slice(0, 10);
    chrome.storage.local.set(patch);
  });
}

function applyPageReplace() {
  if (!settings.pageReplace || !settings.enabled) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','INPUT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest('#pg-root,#pg-doc-root')) return NodeFilter.FILTER_REJECT;
      return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  let total = 0, node;
  const batch = [];
  while ((node = walker.nextNode())) {
    const spans = regexScan(node.textContent);
    if (spans.length) batch.push({ node, spans });
  }
  for (const { node, spans } of batch) {
    node.textContent = redact(node.textContent, spans);
    total += spans.length;
  }
  if (total) showToast(`🛡️ Сторінка: замінено ${total} PII`);
}

// ── Сканування документів ──────────────────────────────────────────────────

// Inject page-level interceptor into Claude/ChatGPT page context.
// inject.js overrides FileReader + showOpenFilePicker in the page JS environment
// and sends __PG_FILE__ via postMessage when a PDF/DOCX/TXT is read.
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('inject.js');
  (document.head || document.documentElement).prepend(s);
  s.onload = () => s.remove();
})();

// Receive intercepted files from inject.js
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.type !== '__PG_FILE__') return;
  if (!settings.enabled || (!settings.docRegex && !settings.docAi)) return;
  const { name, ext, data } = e.data;
  scanDoc(name, ext, data);
});

function scanDoc(fileName, ext, b64) {
  const toast = makeStickyToast(`🔍 Сканую ${fileName}…`);
  chrome.runtime.sendMessage(
    {
      type: 'SCAN_DOC',
      fileName,
      ext,
      data: b64,
      options: { useRegex: settings.docRegex, useAi: settings.docAi, redact: settings.docRedact },
    },
    (res) => {
      toast.remove();
      if (chrome.runtime.lastError || !res) return;
      if (res.error) { showToast(`⚠️ ${res.error}`); return; }
      if (!res.matches.length) { showToast(`✅ ${fileName} — PII не знайдено`); return; }
      trackStats(res.matches.length, 'doc', res.matches.map(m => m.pattern));
      showDocModal(fileName, res.matches, settings.docRedact ? res.redactedText : null);
    }
  );
}

function makeStickyToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1a1a1a;color:#f5a623;padding:10px 18px;border-radius:10px;font-family:system-ui;font-size:13px;z-index:2147483647;border:1px solid #f5a623;box-shadow:0 4px 20px rgba(0,0,0,.4);';
  t.textContent = msg;
  document.body.appendChild(t);
  return t;
}

function showDocModal(fileName, matches, redactedText) {
  document.getElementById('pg-doc-root')?.remove();
  const root = document.createElement('div');
  root.id = 'pg-doc-root';
  const sh = root.attachShadow({ mode: 'open' });

  const SEV_COLOR = { critical: '#ff4444', high: '#ff8c00', medium: '#f5a623', low: '#888' };
  const SEV_LABEL = { critical: 'КРИТИЧНО', high: 'ВИСОКИЙ', medium: 'СЕРЕДНІЙ', low: 'НИЗЬКИЙ' };

  const rows = matches.slice(0, 30).map(m => `
    <div class="row">
      <span class="sev" style="color:${SEV_COLOR[m.severity] || '#888'}">${SEV_LABEL[m.severity] || m.severity}</span>
      <span class="pat">${esc(m.pattern)}</span>
      <span class="val" title="${esc(m.value)}">${esc(m.value)}</span>
    </div>`).join('');

  const more = matches.length > 30
    ? `<div class="more">… і ще ${matches.length - 30} знахідок</div>` : '';

  const dlBtn = redactedText
    ? `<button class="dl">⬇ Завантажити очищений .txt</button>` : '';

  sh.innerHTML = `<style>
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2147483647;display:flex;align-items:center;justify-content:center}
    .box{background:#1a1a1a;color:#eee;border-radius:14px;padding:24px;width:620px;max-width:92vw;max-height:82vh;font-family:system-ui;font-size:14px;display:flex;flex-direction:column;gap:12px}
    h3{margin:0;color:#f5a623;font-size:15px}
    .fname{color:#888;font-size:12px;margin-top:2px}
    .list{overflow-y:auto;flex:1}
    .hdr,.row{display:grid;grid-template-columns:90px 160px 1fr;gap:8px;padding:7px 10px;border-radius:6px;align-items:center;font-size:12px}
    .hdr{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding-bottom:4px}
    .row{background:#2a2a2a;margin-bottom:4px}
    .sev{font-weight:700;font-size:10px}
    .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888}
    .more{text-align:center;color:#555;padding:8px;font-size:12px}
    .btns{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}
    button{padding:9px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}
    .ok{background:#f5a623;color:#000}
    .dl{background:#2a2a2a;color:#f5a623;border:1px solid #f5a62366}
    .cancel{background:transparent;color:#888;border:1px solid #444}
  </style>
  <div class="ov"><div class="box">
    <div>
      <h3>🛡️ Знайдено ${matches.length} PII в документі</h3>
      <div class="fname">📄 ${esc(fileName)}</div>
    </div>
    <div class="list">
      <div class="hdr"><span>Рівень</span><span>Тип</span><span>Значення (масковано)</span></div>
      ${rows}${more}
    </div>
    <div class="btns">
      <button class="cancel">Закрити</button>
      ${dlBtn}
      <button class="ok">Зрозумів</button>
    </div>
  </div></div>`;

  sh.querySelector('.ok').onclick    = () => root.remove();
  sh.querySelector('.cancel').onclick = () => root.remove();

  if (redactedText) {
    sh.querySelector('.dl').onclick = () => {
      const blob = new Blob([redactedText], { type: 'text/plain;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: fileName.replace(/\.(pdf|docx)$/i, '_redacted.txt') });
      a.click();
      URL.revokeObjectURL(url);
    };
  }

  document.body.appendChild(root);
}