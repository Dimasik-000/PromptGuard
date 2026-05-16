// Runs in PAGE context (injected by content.js).
// Intercepts every possible file-access mechanism Claude/ChatGPT may use.
(function () {
  'use strict';

  // ── Dedup: same file within 10 s → send once ─────────────────────────────
  const seen = new Set();
  function dedup(name, size) {
    const k = `${name}:${size}`;
    if (seen.has(k)) return false;
    seen.add(k);
    setTimeout(() => seen.delete(k), 10000);
    return true;
  }

  // Save original FileReader methods BEFORE any override
  const _rAB = FileReader.prototype.readAsArrayBuffer;
  const _rDU = FileReader.prototype.readAsDataURL;
  const _rT  = FileReader.prototype.readAsText;

  function notify(file) {
    if (!(file instanceof File)) return;
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) return;
    if (!dedup(file.name, file.size)) return;

    // Read with original (non-wrapped) FileReader → no recursion
    const r = new FileReader();
    _rDU.call(r, file);
    r.onload  = (e) => window.postMessage({
      type: '__PG_FILE__',
      name: file.name,
      ext:  file.name.split('.').pop().toLowerCase(),
      size: file.size,
      data: e.target.result.split(',')[1],
    }, '*');
    r.onerror = () => {};
  }

  // ── 1. input[type=file] change — page context catches what isolated world misses
  document.addEventListener('change', (e) => {
    if (e.target.type !== 'file') return;
    Array.from(e.target.files || []).forEach(notify);
  }, true);

  // ── 2. fetch — catches FormData file uploads (most common in Claude.ai)
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    if (init?.body instanceof FormData) {
      try {
        for (const [, v] of init.body.entries()) {
          if (v instanceof File) notify(v);
        }
      } catch (_) {}
    }
    return _fetch.apply(this, arguments);
  };

  // ── 3. XMLHttpRequest — legacy backup
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (body instanceof FormData) {
      try {
        for (const [, v] of body.entries()) {
          if (v instanceof File) notify(v);
        }
      } catch (_) {}
    }
    return _send.apply(this, arguments);
  };

  // ── 4. FileReader — catches apps that read before uploading
  function wrap(orig) {
    return function (blob) {
      if (blob instanceof File) notify(blob);
      return orig.apply(this, arguments);
    };
  }
  FileReader.prototype.readAsArrayBuffer = wrap(_rAB);
  FileReader.prototype.readAsDataURL     = wrap(_rDU);
  FileReader.prototype.readAsText        = wrap(_rT);

  // ── 5. showOpenFilePicker (File System Access API)
  if (typeof window.showOpenFilePicker === 'function') {
    const _sfp = window.showOpenFilePicker.bind(window);
    window.showOpenFilePicker = async function (opts) {
      const handles = await _sfp(opts);
      for (const h of handles) {
        try { notify(await h.getFile()); } catch (_) {}
      }
      return handles;
    };
  }

  // ── 6. Drag-and-drop
  document.addEventListener('drop', (e) => {
    Array.from(e.dataTransfer?.files || []).forEach(notify);
  }, true);
})();
