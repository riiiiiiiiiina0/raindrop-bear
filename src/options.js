/* global Toastify */
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
  const notifyEl = /** @type {HTMLInputElement|null} */ (
    document.getElementById('notify-sync')
  );
  const notifyStatusEl = /** @type {HTMLSpanElement|null} */ (
    document.getElementById('notify-status')
  );

  if (
    !(formEl instanceof HTMLFormElement) ||
    !(tokenEl instanceof HTMLInputElement) ||
    !(saveEl instanceof HTMLButtonElement) ||
    !(statusEl instanceof HTMLSpanElement) ||
    !(notifyEl instanceof HTMLInputElement) ||
    !(notifyStatusEl instanceof HTMLSpanElement)
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
      chrome.storage.local.get(['raindropApiToken', 'notifyOnSync'], (data) => {
        if (tokenEl) tokenEl.value = (data && data.raindropApiToken) || '';
        const enabled =
          data && typeof data.notifyOnSync === 'boolean'
            ? data.notifyOnSync
            : true; // default ON
        if (notifyEl) notifyEl.checked = !!enabled;
      });
    } catch (_) {}
  }

  function save() {
    if (saveEl) saveEl.disabled = true;
    setStatus('Saving…', 'info');
    const value = tokenEl ? tokenEl.value.trim() : '';
    try {
      chrome.storage.local.set({ raindropApiToken: value }, () => {
        try {
          // Show toast instead of inline "Saved" text
          /** @type {any} */ (window)
            .Toastify({
              text: '🔐 API token saved',
              duration: 3000,
              position: 'right',
              style: { background: '#22c55e' },
            })
            .showToast();
        } catch (_) {}
        // Clear inline status text after success
        if (statusEl) statusEl.textContent = '';
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
  // notifications toggle: save immediately
  if (notifyEl)
    notifyEl.addEventListener('change', () => {
      const value = !!notifyEl.checked;
      if (notifyStatusEl) {
        notifyStatusEl.textContent = 'Saving…';
        notifyStatusEl.className = 'text-sm text-blue-600 dark:text-blue-400';
      }
      try {
        chrome.storage.local.set({ notifyOnSync: value }, () => {
          try {
            // Show toast instead of inline "Saved" text
            /** @type {any} */ (window)
              .Toastify({
                text: '📣 Notification preference saved',
                duration: 3000,
                position: 'right',
                style: { background: '#3b82f6' },
              })
              .showToast();
          } catch (_) {}
          if (notifyStatusEl) notifyStatusEl.textContent = '';
        });
      } catch (_) {
        if (notifyStatusEl) {
          notifyStatusEl.textContent = 'Failed to save';
          notifyStatusEl.className = 'text-sm text-red-600 dark:text-red-400';
        }
      }
    });
  load();
})();
