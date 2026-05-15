const SHORTCUTS = [
  { key: 'shift', label: '⇧ Shift',  combo: '⌘ Shift+V' },
  { key: 'alt',   label: '⌥ Option', combo: '⌘ Option+V' },
  { key: 'ctrl',  label: '⌃ Ctrl',   combo: '⌃ Ctrl+V' },
];

let settings = { mode: 'modal', enabled: true, shortcut: 'shift' };

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

chrome.storage.sync.get({ mode: 'modal', enabled: true, shortcut: 'shift' }, (s) => {
  settings = s;
  render();
});

document.getElementById('opt-modal').addEventListener('click', () => save({ mode: 'modal' }));
document.getElementById('opt-auto').addEventListener('click', () => save({ mode: 'auto' }));
document.getElementById('enabled-toggle').addEventListener('change', (e) => save({ enabled: e.target.checked }));
