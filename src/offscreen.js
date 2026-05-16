import { pipeline, env } from '@huggingface/transformers';
import mammoth from 'mammoth';

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('transformers/');
env.backends.onnx.wasm.numThreads = 1;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');

// ── NER model (lazy) ──────────────────────────────────────────────────────
let ner = null;
async function getModel() {
  if (!ner) ner = await pipeline('token-classification', 'bert-base-NER', { device: 'wasm', dtype: 'q8' });
  return ner;
}

// ── Paste-scan helpers (existing flow) ───────────────────────────────────
function regexScan(text) {
  const spans = [];
  const rules = [
    [/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, 'EMAIL'],
    [/(?:вул\.?|улица|street|st\.?|ave\.?|avenue|просп\.?|проспект|бульв\.?|бульвар|пров\.?|площа|square)\s+[A-Za-zА-Яа-яІіЇїЄє0-9'’.\-\s]{2,40}?\s+\d+[A-Za-zА-Яа-я]?(?=[,.;:]|\s|$)/gi, 'ADDRESS'],
    [/\+?[\d\s\-() ]{7,15}\d/g, 'PHONE'],
    [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CC'],
    [/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, 'JWT'],
    [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY'],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP'],
  ];
  for (const [re, type] of rules) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text)) !== null)
      spans.push({ start: m.index, end: m.index + m[0].length, type });
  }
  return spans;
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

function merge(spans) {
  return spans.sort((a,b)=>a.start-b.start).reduce((acc,s)=>{
    if (acc.length && s.start < acc[acc.length-1].end) return acc;
    acc.push(s); return acc;
  }, []);
}

function redact(text, spans) {
  let out = '', i = 0;
  for (const s of spans) {
    out += text.slice(i, s.start) + `[REDACTED_${s.type}]`;
    i = s.end;
  }
  return out + text.slice(i);
}

// ── Document patterns (tighter — require context for ambiguous types) ─────
const DOC_PATTERNS = [
  // Credentials (no ambiguity — keep broad)
  { name: 'API Key',
    severity: 'critical',
    re: /(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9\-_]{20,})["']?/gi },
  { name: 'AWS Key',
    severity: 'critical',
    re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Private Key',
    severity: 'critical',
    re: /-----BEGIN\s(?:RSA\s|EC\s)?PRIVATE KEY-----/g },
  { name: 'Password',
    severity: 'high',
    re: /(?:password|passwd|pwd|пароль)\s*[:=]\s*["']?(\S{6,})["']?/gi },
  // JWT: require min token length (avoid short false positives)
  { name: 'JWT',
    severity: 'high',
    re: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]+\b/g },

  // Financial
  { name: 'Credit Card',
    severity: 'critical',
    re: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g },
  // IBAN: limit to real country codes
  { name: 'IBAN',
    severity: 'high',
    re: /\b(?:UA|DE|PL|GB|FR|NL|IT|ES|CZ|SK|HU|RO|BG)\d{2}[A-Z0-9]{4}\d{7,26}\b/g },
  { name: 'CVV',
    severity: 'high',
    re: /\b(?:cvv|cvc2?|cvv2)\s*[:=]?\s*\d{3,4}\b/gi },

  // Identity — require keyword context to avoid false positives
  { name: 'SSN (US)',
    severity: 'critical',
    re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // ІПН: requires keyword before the 10 digits
  { name: 'ІПН (UA)',
    severity: 'critical',
    re: /(?:ІПН|РНОКПП|IPN|інн)\s*[:№]?\s*(\d{10})\b/gi },
  // Паспорт: requires keyword context
  { name: 'Паспорт UA',
    severity: 'critical',
    re: /(?:паспорт|серія|passport)\s*[:№]?\s*([А-ЯІЇЄ]{2}\s*\d{6}|[A-Z]{2}\s*\d{6})\b/gi },

  // Contact
  { name: 'Email',
    severity: 'medium',
    re: /\b[A-Za-z0-9._%+\-]{2,}@[A-Za-z0-9.\-]{2,}\.[A-Za-z]{2,}\b/g },
  { name: 'Address',
    severity: 'medium',
    re: /(?:вул\.?|улица|street|st\.?|ave\.?|avenue|просп\.?|проспект|бульв\.?|бульвар|пров\.?|площа|square)\s+[A-Za-zА-Яа-яІіЇїЄє0-9'’.\-\s]{2,40}?\s+\d+[A-Za-zА-Яа-я]?(?=[,.;:]|\s|$)/gi },
  // Phone: specifically Ukrainian +380XX or 0XX formats
  { name: 'Телефон',
    severity: 'medium',
    re: /(?:\+38\s?0|\b0)(?:\d[\s\-]?){8,9}\d\b/g },
  // IP: first octet must be non-trivial (≥10) to avoid version strings like 1.2.3.4
  { name: 'IP-адреса',
    severity: 'low',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d)\.)(?:\d{1,3}\.){2}\d{1,3}\b(?!\.\d)/g },
];

// ── Doc scan helpers ──────────────────────────────────────────────────────
function maskValue(val) {
  if (!val || val.length <= 4) return '****';
  const show = Math.min(3, Math.floor(val.length * 0.2));
  return val.slice(0, show) + '***' + val.slice(-2);
}

function getContext(text, idx, len) {
  const r = 55, s = Math.max(0, idx - r), e = Math.min(text.length, idx + len + r);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ') + (e < text.length ? '…' : '');
}

function scanDocText(text) {
  const matches = [];
  for (const p of DOC_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ pattern: p.name, severity: p.severity, value: maskValue(m[0]), context: getContext(text, m.index, m[0].length), source: 'regex' });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return matches;
}

function redactDocText(text) {
  const hits = [];
  for (const p of DOC_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m;
    while ((m = re.exec(text)) !== null)
      hits.push({ start: m.index, end: m.index + m[0].length, label: p.name });
  }
  hits.sort((a, b) => a.start - b.start);
  let out = '', i = 0;
  for (const h of hits) {
    if (h.start < i) continue;
    out += text.slice(i, h.start) + `[REDACTED_${h.label.replace(/\s+/g, '_').toUpperCase()}]`;
    i = h.end;
  }
  return out + text.slice(i);
}

// Structured report instead of raw redacted text
function generateReport(fileName, matches, redactedText) {
  const date = new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const line54 = '─'.repeat(54);
  const eq54   = '═'.repeat(54);
  const RANK   = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...matches].sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9));

  const header =
    `🛡️  PromptGuard — Звіт редагування\n${line54}\n` +
    `Файл    : ${fileName}\nДата    : ${date}\nЗнайдено: ${matches.length} PII\n${line54}\n`;

  const findings = sorted.map((m, i) => {
    const src = m.source === 'ai' ? '[AI]' : '[RX]';
    const sev = m.severity.toUpperCase().padEnd(8);
    let entry = `${String(i + 1).padStart(2)}. ${src} ${sev}  ${m.pattern}\n` +
                `    Значення : ${m.value}\n` +
                `    Контекст : ${m.context}`;
    if (m.explanation) entry += `\n    Причина  : ${m.explanation}`;
    return entry;
  }).join('\n\n');

  return `${header}\nЗНАХІДКИ:\n\n${findings}\n\n${eq54}\nРЕДАГОВАНИЙ ТЕКСТ\n${eq54}\n\n${redactedText}`;
}

// ── Claude AI analysis ────────────────────────────────────────────────────
async function analyzeWithClaude(text, apiKey, regexMatches) {
  const alreadyFound = [...new Set(regexMatches.map(m => m.pattern))].join(', ') || 'нічого';
  const prompt =
    `Ти — аналітик безпеки даних. Знайди чутливі дані які regex пропустив.\n` +
    `Regex знайшов: ${alreadyFound}.\n` +
    `Шукай: імена з контекстом, адреси, медичні дані, фінансові деталі без формату, внутрішні коди.\n\n` +
    `Текст:\n"""\n${text.slice(0, 3000)}\n"""\n\n` +
    `Відповідай ТІЛЬКИ JSON масивом. Якщо нічого — [].\n` +
    `Формат: [{"type":"тип","severity":"critical|high|medium|low","value":"до 50 символів","context":"речення","explanation":"чому чутливі"}]`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  const raw  = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const arr  = raw.match(/\[[\s\S]*\]/)?.[0];
  if (!arr) return [];

  return JSON.parse(arr).map(f => ({
    pattern:     f.type     || 'Unknown',
    severity:    f.severity || 'medium',
    value:       maskValue(f.value || ''),
    context:     f.context  || '',
    source:      'ai',
    explanation: f.explanation || '',
  }));
}

// ── Text extraction ───────────────────────────────────────────────────────
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const ab = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(ab);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return ab;
}

function extractPdfText(ab) {
  const bytes = new Uint8Array(ab);
  let result = '', run = '';
  for (const c of bytes) {
    if ((c >= 32 && c < 127) || c === 10 || c === 13) {
      run += String.fromCharCode(c === 13 ? 10 : c);
    } else {
      if (run.length >= 5 && /[A-Za-z0-9@]/.test(run)) result += run + ' ';
      run = '';
    }
  }
  if (run.length >= 5 && /[A-Za-z0-9@]/.test(run)) result += run;
  return result;
}

async function extractText(ext, ab) {
  if (ext === 'docx') { const { value } = await mammoth.extractRawText({ arrayBuffer: ab }); return value; }
  if (ext === 'pdf')  return extractPdfText(ab);
  return new TextDecoder().decode(ab);
}

// ── Message router ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _, respond) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'SCAN') {
    (async () => {
      const model    = await getModel();
      const nerOut   = await model(msg.text, { aggregation_strategy: 'simple' });
      const nerSpans = nerOut.map(e => ({ start: e.start, end: e.end, type: e.entity_group }));
      const all      = markPreservedPhones(merge([...regexScan(msg.text), ...nerSpans]));
      respond({ redacted: redact(msg.text, all), spans: all });
    })();
    return true;
  }

  if (msg.type === 'SCAN_DOC') {
    (async () => {
      try {
        const ab   = base64ToArrayBuffer(msg.data);
        const text = await extractText(msg.ext, ab);

        if (!text.trim()) { respond({ matches: [], redactedText: null }); return; }

        let matches = msg.options.useRegex ? scanDocText(text) : [];

        if (msg.options.useAi && msg.apiKey) {
          try {
            const aiMatches = await analyzeWithClaude(text, msg.apiKey, matches);
            matches = [...matches, ...aiMatches];
          } catch (_) {}
        }

        const redactedText = msg.options.redact
          ? generateReport(msg.fileName, matches, redactDocText(text))
          : null;

        respond({ matches, redactedText });
      } catch (e) {
        respond({ error: e.message, matches: [] });
      }
    })();
    return true;
  }
});
