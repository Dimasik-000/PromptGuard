console.log('[BG] Background script started');

let created = false;

async function ensureOffscreen() {
  if (created) return;
  console.log('[BG] Creating offscreen...');
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'NER inference'
    });
    created = true;
    console.log('[BG] Offscreen created OK');
  } catch (e) {
    console.error('[BG] Offscreen error:', e);
    created = true;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  console.log('[BG] Message received:', msg.type);
  if (msg.type === 'SCAN') {
    ensureOffscreen().then(() => {
      console.log('[BG] Forwarding to offscreen...');
      chrome.runtime.sendMessage(
        { ...msg, target: 'offscreen' },
        (result) => {
          console.log('[BG] Offscreen responded:', result);
          respond(result);
        }
      );
    });
    return true;
  }
});
