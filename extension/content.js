console.log('[PromptGuard] loaded');

let lastInput = null;
document.addEventListener('focusin', (e) => {
  if (e.target.isContentEditable || e.target.tagName === 'TEXTAREA') {
    lastInput = e.target;
  }
});

document.addEventListener('paste', async (e) => {
  const text = e.clipboardData?.getData('text');
  if (!text || text.length < 3) return;

  const spans = regexScan(text);
  if (spans.length === 0) return;

  e.preventDefault();
  e.stopPropagation();

  const targetEl = lastInput || document.activeElement;
  showModal(text, redact(text, spans), spans, targetEl);
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

function showModal(original, redacted, spans, targetEl) {
  document.getElementById('pg-root')?.remove();
  const root = document.createElement('div');
  root.id = 'pg-root';
  const s = root.attachShadow({ mode: 'open' });
  s.innerHTML = `<style>
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483647;display:flex;align-items:center;justify-content:center}
    .box{background:#1a1a1a;color:#eee;border-radius:14px;padding:24px;width:540px;max-width:90vw;font-family:system-ui;font-size:14px}
    h3{margin:0 0 14px;color:#f5a623}
    .lbl{color:#888;font-size:11px;margin-bottom:4px;text-transform:uppercase}
    .txt{background:#2a2a2a;border-radius:8px;padding:12px;margin-bottom:14px;white-space:pre-wrap;line-height:1.6;word-break:break-word;max-height:150px;overflow-y:auto}
    .hi{color:#f5a623;font-weight:bold}
    .btns{display:flex;gap:8px;justify-content:flex-end}
    button{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500}
    .ok{background:#f5a623;color:#000}
    .orig{background:#333;color:#eee}
    .cancel{background:transparent;color:#888;border:1px solid #444}
  </style>
  <div class="ov"><div class="box">
    <h3>🛡️ PromptGuard — знайдено ${spans.length} PII</h3>
    <div class="lbl">Буде відправлено:</div>
    <div class="txt">${hl(redacted)}</div>
    <div class="lbl">Оригінал:</div>
    <div class="txt">${esc(original)}</div>
    <div class="btns">
      <button class="cancel">Скасувати</button>
      <button class="orig">Оригінал</button>
      <button class="ok">✓ Відправити без PII</button>
    </div>
  </div></div>`;

  s.querySelector('.ok').onclick = () => { root.remove(); insert(redacted, targetEl); };
  s.querySelector('.orig').onclick = () => { root.remove(); insert(original, targetEl); };
  s.querySelector('.cancel').onclick = () => root.remove();
  document.body.appendChild(root);
}

function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function hl(t) { return esc(t).replace(/\[REDACTED_\w+\]/g, m => `<span class="hi">${m}</span>`); }