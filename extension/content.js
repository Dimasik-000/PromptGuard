console.log('[PromptGuard] loaded v2.0.0');

const MODAL_STRINGS = {
  uk: {
    pasteTitle:   'знайдено',
    piiLabel:     'PII',
    chipsLabel:   'Знахідки — клікни щоб залишити оригінал:',
    phonePolicyHint: 'Перші 2 телефони залишаються без змін',
    willSend:     'Буде відправлено:',
    editHint:     'редагуйте за потреби',
    originalLabel:'Оригінал:',
    bypassHint:   '⌘ Shift+V — вставити без сканування',
    cancel:       'Скасувати',
    sendOriginal: 'Оригінал',
    send:         '✓ Відправити',
    toastAuto:    'PII замінено',
    toastPage:    'Сторінка: замінено',
    toastNone:    'PII не знайдено',
    docTitle:     'Знайдено',
    docPii:       'PII в документі',
    colLevel:     'Рівень',
    colType:      'Тип',
    colValue:     'Значення (масковано)',
    moreFindings: 'і ще',
    findings:     'знахідок',
    close:        'Закрити',
    understood:   'Зрозумів',
    download:     '⬇ Завантажити очищений .txt',
    sev: { critical: 'КРИТИЧНО', high: 'ВИСОКИЙ', medium: 'СЕРЕДНІЙ', low: 'НИЗЬКИЙ' },
  },
  en: {
    pasteTitle:   'found',
    piiLabel:     'PII',
    chipsLabel:   'Findings — click to keep original:',
    phonePolicyHint: 'First 2 phone numbers stay unchanged',
    willSend:     'Will be sent:',
    editHint:     'edit if needed',
    originalLabel:'Original:',
    bypassHint:   '⌘ Shift+V — paste without scanning',
    cancel:       'Cancel',
    sendOriginal: 'Original',
    send:         '✓ Send',
    toastAuto:    'PII replaced',
    toastPage:    'Page: replaced',
    toastNone:    'no PII found',
    docTitle:     'Found',
    docPii:       'PII in document',
    colLevel:     'Level',
    colType:      'Type',
    colValue:     'Value (masked)',
    moreFindings: 'and',
    findings:     'more findings',
    close:        'Close',
    understood:   'OK',
    download:     '⬇ Download clean .txt',
    sev: { critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' },
  },
};

function mt() { return MODAL_STRINGS[settings?.lang] || MODAL_STRINGS[DEFAULT_LANG]; }

// Force English UI by default to ensure consistent experience across pages
const DEFAULT_LANG = 'en';

let settings = { mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false, lang: DEFAULT_LANG };

chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift', docRegex: true, docAi: false, docRedact: false, pageReplace: false, lang: DEFAULT_LANG }, (s) => {
  settings = s;
  // Force UI language to DEFAULT_LANG to ensure consistent English strings
  settings.lang = DEFAULT_LANG;
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
  const t = e.target;
  if (!t) return;
  try {
    if (t.nodeType === 1 && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || (t.getAttribute && (t.getAttribute('role') === 'textbox' || (t.matches && t.matches('[contenteditable], [role="textbox"], textarea, input')))))) {
      lastInput = t;
    }
  } catch (err) { /* some nodes may throw on matches(); ignore */ }
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

  const spans = markPreservedPhones(regexScan(text));
  const redactableCount = spans.filter(s => !s.preserve).length;
  if (redactableCount === 0) {
    console.log('[PromptGuard] no PII');
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  // Prefer the event's composed path to find the actual editable element (works with shadow DOM)
  const path = (e.composedPath && e.composedPath()) || [];
  const pathEditable = path.find(n => {
    if (!n || n.nodeType !== 1) return false;
    try {
      return n.isContentEditable || n.tagName === 'TEXTAREA' || n.tagName === 'INPUT' || (n.getAttribute && (n.getAttribute('role') === 'textbox' || (n.matches && n.matches('[contenteditable], [role="textbox"], textarea, input'))));
    } catch (err) { return false; }
  });
  const targetEl = pathEditable || lastInput || document.activeElement;
  const redacted = redact(text, spans);

  console.log('[PromptGuard] mode:', settings.mode, 'spans:', spans.length);

  if (settings.mode === 'auto') {
    insert(redacted, targetEl);
    trackStats(spans.length, 'paste', spans.map(s => s.type));
    showToast(`🛡️ ${spans.length} ${mt().toastAuto}`);
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

  const spans = markPreservedPhones(regexScan(raw));
  const redactableCount = spans.filter(s => !s.preserve).length;
  if (!redactableCount) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const redacted = redact(raw, spans);

  if (settings.mode === 'auto') {
    insert(redacted, el);
    trackStats(spans.length, 'paste', spans.map(s => s.type));
    showToast(`🛡️ ${spans.length} ${mt().toastAuto}`);
    fireEnter(el);
  } else {
    showModal(raw, redacted, spans, el, () => fireEnter(el));
  }
}, true);

function regexScan(text) {
  const spans = [];
  const rules = [
    [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CC'],   // CC before PHONE so it wins on equal-length matches
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, 'EMAIL'],
    [/(?:вул\.?|улица|street|st\.?|ave\.?|avenue|просп\.?|проспект|бульв\.?|бульвар|пров\.?|площа|square)\s+[A-Za-zА-Яа-яІіЇїЄє0-9'’.\-\s]{2,40}?\s+\d+[A-Za-zА-Яа-я]?(?=[,.;:]|\s|$)/gi, 'ADDRESS'],
    [/\+?[\d\s\-() ]{7,15}\d/g, 'PHONE'],
    [/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, 'JWT'],
    [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP'],
  ];
  for (const [re, type] of rules) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null)
      spans.push({ start: m.index, end: m.index + m[0].length, type });
  }
  // Sort by start; on overlap keep the longer match (CC beats PHONE, etc.)
  spans.sort((a, b) => a.start - b.start);
  return spans.reduce((acc, s) => {
    if (!acc.length) { acc.push(s); return acc; }
    const last = acc[acc.length - 1];
    if (s.start >= last.end) { acc.push(s); return acc; }
    if ((s.end - s.start) > (last.end - last.start)) acc[acc.length - 1] = s;
    return acc;
  }, []);
}

function markPreservedPhones(spans, keep = 2) {
  let kept = 0;
  return spans.map(s => {
    if (s.type === 'PHONE' && kept < keep) {
      kept += 1;
      return { ...s, preserve: true };
    }
    return s;
  });
}

function redact(text, spans) {
  let out = '', i = 0;
  for (const s of spans) {
    if (s.preserve) {
      out += text.slice(i, s.end);
      i = s.end;
      continue;
    }
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
  const sh = root.attachShadow({ mode: 'open' });
  const T = mt();

  const chipState = spans.map(s => !s.preserve); // true = redact, false = keep original

  function maskChip(v) {
    if (v.length <= 4) return '***';
    return v.slice(0, 2) + '…' + v.slice(-2);
  }

  function buildText() {
    let out = '', i = 0;
    for (let idx = 0; idx < spans.length; idx++) {
      const s = spans[idx];
      out += original.slice(i, s.start);
      out += chipState[idx] ? `[REDACTED_${s.type}]` : original.slice(s.start, s.end);
      i = s.end;
    }
    return out + original.slice(i);
  }

  const st = document.createElement('style');
  st.textContent =
    '.ov{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center}' +
    '.box{background:#1a1a1a;color:#eee;border-radius:14px;padding:24px;width:540px;max-width:90vw;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;box-sizing:border-box}' +
    'h3{margin:0 0 14px;color:#f5a623}' +
    '.lbl{color:#888;font-size:11px;margin-bottom:4px;text-transform:uppercase;display:flex;align-items:center;gap:6px}' +
    '.lbl-hint{color:#555;font-size:10px;font-style:italic;text-transform:none}' +
    '.chips{margin-bottom:12px;line-height:2.2}' +
    '.chip{display:inline-block;padding:3px 8px;border-radius:12px;font-size:11px;cursor:pointer;margin:2px 3px;background:#2a2a2a;color:#555;border:1px solid #444;transition:.15s;font-family:monospace;user-select:none}' +
    '.chip.on{background:#2d1c00;color:#f5a623;border-color:#f5a623}' +
    '.txt{background:#2a2a2a;border-radius:8px;padding:12px;margin-bottom:14px;white-space:pre-wrap;line-height:1.6;word-break:break-word;max-height:130px;overflow-y:auto}' +
    '.edit{background:#2a2a2a;border:1px solid #3a3a3a;border-radius:8px;padding:12px;margin-bottom:14px;line-height:1.6;word-break:break-word;min-height:60px;max-height:140px;overflow-y:auto;width:100%;box-sizing:border-box;resize:vertical;color:#eee;font-size:13px}' +
    '.edit:focus{outline:none;border-color:#f5a623}' +
    '.hint{font-size:11px;color:#555;text-align:right;margin-top:-10px;margin-bottom:10px}' +
    '.btns{display:flex;gap:8px;justify-content:flex-end}' +
    'button{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}' +
    '.ok{background:#f5a623;color:#000}' +
    '.orig{background:#333;color:#eee}' +
    '.cancel{background:transparent;color:#888;border:1px solid #444}';
  sh.appendChild(st);

  const chips = spans.map((s, i) => {
    const raw = original.slice(s.start, s.end);
    return `<span class="chip on" data-idx="${i}">[${s.type}] ${maskChip(raw)}</span>`;
  }).join('');

  const wrap = document.createElement('div');
  wrap.innerHTML =
    `<div class="ov"><div class="box">` +
    `<h3>🛡️ PromptGuard — ${T.pasteTitle} ${spans.length} ${T.piiLabel}</h3>` +
    `<div class="lbl">${T.chipsLabel} <span class="lbl-hint">${T.phonePolicyHint}</span></div>` +
    `<div class="chips">${chips}</div>` +
    `<div class="lbl">${T.willSend} <span class="lbl-hint">${T.editHint}</span></div>` +
    `<textarea class="edit">${esc(buildText())}</textarea>` +
    `<div class="lbl">${T.originalLabel}</div>` +
    `<div class="txt">${esc(original)}</div>` +
    `<div class="hint">${T.bypassHint}</div>` +
    `<div class="btns">` +
    `<button class="cancel">${T.cancel}</button>` +
    `<button class="orig">${T.sendOriginal}</button>` +
    `<button class="ok">${T.send}</button>` +
    `</div></div></div>`;
  sh.appendChild(wrap.firstElementChild);

  sh.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx, 10);
      chipState[idx] = !chipState[idx];
      chip.className = 'chip' + (chipState[idx] ? ' on' : '');
      sh.querySelector('.edit').value = buildText();
    });
  });

  sh.querySelector('.ok').onclick = () => {
    const text = sh.querySelector('.edit').value;
    const redactedCount = chipState.filter(Boolean).length;
    trackStats(redactedCount, 'paste', spans.filter((_, i) => chipState[i]).map(sp => sp.type));
    root.remove();
    insert(text, targetEl);
    if (onSend) onSend();
  };
  sh.querySelector('.orig').onclick = () => {
    root.remove();
    insert(original, targetEl);
    if (onSend) onSend();
  };
  sh.querySelector('.cancel').onclick = () => root.remove();
  // Some pages (ChatGPT) use complex DOM; append to documentElement if body isn't accepting overlays
  try { document.body.appendChild(root); } catch (e) { document.documentElement.appendChild(root); }
}

function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
    const spans = markPreservedPhones(regexScan(node.textContent));
    if (spans.length) batch.push({ node, spans });
  }
  for (const { node, spans } of batch) {
    node.textContent = redact(node.textContent, spans);
    total += spans.length;
  }
  if (total) showToast(`🛡️ ${mt().toastPage} ${total} ${mt().piiLabel}`);
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
  const toast = makeStickyToast(`🔍 ${fileName}…`);
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
      if (!res.matches.length) { showToast(`✅ ${fileName} — ${mt().toastNone}`); return; }
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
  const T = mt();

  const SEV_COLOR = { critical: '#ff4444', high: '#ff8c00', medium: '#f5a623', low: '#888' };

  const rows = matches.slice(0, 30).map(m => `
    <div class="row">
      <span class="sev" style="color:${SEV_COLOR[m.severity] || '#888'}">${T.sev[m.severity] || m.severity}</span>
      <span class="pat">${esc(m.pattern)}</span>
      <span class="val" title="${esc(m.value)}">${esc(m.value)}</span>
    </div>`).join('');

  const more = matches.length > 30
    ? `<div class="more">… ${T.moreFindings} ${matches.length - 30} ${T.findings}</div>` : '';

  const dlBtn = redactedText
    ? `<button class="dl">${T.download}</button>` : '';

  const st = document.createElement('style');
  st.textContent =
    '.ov{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.7);z-index:2147483647;display:flex;align-items:center;justify-content:center}' +
    '.box{background:#1a1a1a;color:#eee;border-radius:14px;padding:24px;width:620px;max-width:92vw;max-height:82vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}' +
    'h3{margin:0;color:#f5a623;font-size:15px}' +
    '.fname{color:#888;font-size:12px;margin-top:2px}' +
    '.list{overflow-y:auto;flex:1}' +
    '.hdr,.row{display:grid;grid-template-columns:90px 160px 1fr;gap:8px;padding:7px 10px;border-radius:6px;align-items:center;font-size:12px}' +
    '.hdr{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding-bottom:4px}' +
    '.row{background:#2a2a2a;margin-bottom:4px}' +
    '.sev{font-weight:700;font-size:10px}' +
    '.val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#888}' +
    '.more{text-align:center;color:#555;padding:8px;font-size:12px}' +
    '.btns{display:flex;gap:8px;justify-content:flex-end;flex-shrink:0}' +
    'button{padding:9px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}' +
    '.ok{background:#f5a623;color:#000}' +
    '.dl{background:#2a2a2a;color:#f5a623;border:1px solid #f5a62366}' +
    '.cancel{background:transparent;color:#888;border:1px solid #444}';
  sh.appendChild(st);

  const wrap = document.createElement('div');
  wrap.innerHTML =
    `<div class="ov"><div class="box">` +
    `<div><h3>🛡️ ${T.docTitle} ${matches.length} ${T.docPii}</h3>` +
    `<div class="fname">📄 ${esc(fileName)}</div></div>` +
    `<div class="list">` +
    `<div class="hdr"><span>${T.colLevel}</span><span>${T.colType}</span><span>${T.colValue}</span></div>` +
    `${rows}${more}</div>` +
    `<div class="btns"><button class="cancel">${T.close}</button>${dlBtn}<button class="ok">${T.understood}</button></div>` +
    `</div></div>`;
  sh.appendChild(wrap.firstElementChild);

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
