import { pipeline, env } from '@huggingface/transformers';

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('transformers/');
env.backends.onnx.wasm.numThreads = 1;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('models/');

let ner = null;
async function getModel() {
  if (!ner) ner = await pipeline('token-classification', 'bert-base-NER', { device: 'wasm', dtype: 'q8' });
  return ner;
}

function regexScan(text) {
  const spans = [];
  const rules = [
    [/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, 'EMAIL'],
    [/\+?[\d\s\-(). ]{7,15}\d/g,     'PHONE'],
    [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'CC'],
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
  return spans;
}

function merge(spans) {
  return spans.sort((a,b)=>a.start-b.start).reduce((acc,s)=>{
    if (acc.length && s.start < acc[acc.length-1].end) return acc;
    acc.push(s); return acc;
  }, []);
}

function redact(text, spans) {
  let out = '', i = 0;
  for (const s of spans) { out += text.slice(i, s.start) + `[REDACTED_${s.type}]`; i = s.end; }
  return out + text.slice(i);
}

chrome.runtime.onMessage.addListener((msg, _, respond) => {
  if (msg.target !== 'offscreen' || msg.type !== 'SCAN') return;
  (async () => {
    const model = await getModel();
    const nerOut = await model(msg.text, { aggregation_strategy: 'simple' });
    const nerSpans = nerOut.map(e => ({ start: e.start, end: e.end, type: e.entity_group }));
    const all = merge([...regexScan(msg.text), ...nerSpans]);
    respond({ redacted: redact(msg.text, all), spans: all });
  })();
  return true;
});
