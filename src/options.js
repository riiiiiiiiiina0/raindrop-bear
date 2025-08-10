(() => {
  const formEl = /** @type {HTMLFormElement|null} */ (
    document.getElementById('auth-form')
  );
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
    !(formEl instanceof HTMLFormElement) ||
    !(tokenEl instanceof HTMLInputElement) ||
    !(saveEl instanceof HTMLButtonElement) ||
    !(statusEl instanceof HTMLSpanElement)
  ) {
    // DOM not ready; abort quietly
    return;
  }

  /**
   * @param {string} text
   * @param {"success"|"error"|"info"} [type]
   */
  function setStatus(text, type) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    const colorClass =
      type === 'success'
        ? 'text-green-600 dark:text-green-400'
        : type === 'error'
        ? 'text-red-600 dark:text-red-400'
        : 'text-blue-600 dark:text-blue-400';
    statusEl.className = `text-sm ${colorClass}`;
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
    setStatus('Saving…', 'info');
    const value = tokenEl ? tokenEl.value.trim() : '';
    try {
      chrome.storage.local.set({ raindropApiToken: value }, () => {
        setStatus('Saved', 'success');
        if (saveEl) saveEl.disabled = false;
      });
    } catch (e) {
      setStatus('Failed to save', 'error');
      if (saveEl) saveEl.disabled = false;
    }
  }

  if (saveEl) saveEl.addEventListener('click', save);
  if (formEl)
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
  load();
})();
