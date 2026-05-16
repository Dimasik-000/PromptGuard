const CHAT_RULES = [
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CC'],
  [/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi, 'EMAIL'],
  [/(?:вул\.?|улица|street|st\.?|ave\.?|avenue|просп\.?|проспект|бульв\.?|бульвар|пров\.?|площа|square)\s+[A-Za-zА-Яа-яІіЇїЄє0-9'’.\-\s]{2,40}?\s+\d+[A-Za-zА-Яа-я]?(?=[,.;:]|\s|$)/gi, 'ADDRESS'],
  [/\+?[\d\s\-() ]{7,15}\d/g, 'PHONE'],
  [/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, 'JWT'],
  [/AKIA[0-9A-Z]{16}/g, 'AWS_KEY'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'IP']
];

function regexScan(text) {
  const spans = [];
  for (const [re, type] of CHAT_RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, type });
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return spans.reduce((acc, s) => {
    if (!acc.length) {
      acc.push(s);
      return acc;
    }
    const last = acc[acc.length - 1];
    if (s.start >= last.end) {
      acc.push(s);
      return acc;
    }
    if ((s.end - s.start) > (last.end - last.start)) {
      acc[acc.length - 1] = s;
    }
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
  let out = '';
  let i = 0;
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

function scanAndRedact(text, keepPhones = 2) {
  const spans = markPreservedPhones(regexScan(text), keepPhones);
  const redacted = redact(text, spans);
  const redactableCount = spans.filter(s => !s.preserve).length;
  return { spans, redacted, redactableCount };
}

module.exports = {
  regexScan,
  markPreservedPhones,
  redact,
  scanAndRedact
};
