(() => {
  const tokenEl = /** @type {HTMLInputElement|null} */ (
    document.getElementById('token')
  );
  const saveEl = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save')
  );
  const statusEl = /** @type {HTMLSpanElement|null} */ (
    document.getElementById('status')
  );

  if (
    !(tokenEl instanceof HTMLInputElement) ||
    !(saveEl instanceof HTMLButtonElement) ||
    !(statusEl instanceof HTMLSpanElement)
  ) {
    // DOM not ready; abort quietly
    return;
  }

  function setStatus(text, ok) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className = `ml-3 text-sm ${
      ok ? 'text-green-600' : 'text-red-600'
    }`;
  }

  function load() {
    try {
      chrome.storage.local.get('raindropApiToken', (data) => {
        if (tokenEl) tokenEl.value = (data && data.raindropApiToken) || '';
      });
    } catch (_) {}
  }

  function save() {
    if (saveEl) saveEl.disabled = true;
    setStatus('Saving…', true);
    const value = tokenEl ? tokenEl.value.trim() : '';
    try {
      chrome.storage.local.set({ raindropApiToken: value }, () => {
        setStatus('Saved', true);
        if (saveEl) saveEl.disabled = false;
      });
    } catch (e) {
      setStatus('Failed to save', false);
      if (saveEl) saveEl.disabled = false;
    }
  }

  if (saveEl) saveEl.addEventListener('click', save);
  load();
})();
