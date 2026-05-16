console.log('[BG] started v2.0.0');

let created = false;

async function ensureOffscreen() {
  if (created) return;
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'NER inference'
    });
    created = true;
  } catch (e) {
    created = true;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  // Отримати налаштування
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift' }, respond);
    return true;
  }

  // Скан PII (текст)
  if (msg.type === 'SCAN') {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage({ ...msg, target: 'offscreen' }, respond);
    });
    return true;
  }

  // Скан документу (PDF / DOCX / TXT)
  if (msg.type === 'SCAN_DOC') {
    ensureOffscreen().then(() => {
      chrome.storage.local.get({ anthropicKey: '' }, (local) => {
        chrome.runtime.sendMessage({ ...msg, target: 'offscreen', apiKey: local.anthropicKey }, respond);
      });
    });
    return true;
  }
});

// При зміні налаштувань — повідомити всі вкладки
chrome.storage.onChanged.addListener((changes) => {
  chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift' }, (settings) => {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {});
      });
    });
  });
});