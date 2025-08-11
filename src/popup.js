(() => {
  const syncBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('sync-btn')
  );
  const saveBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-btn')
  );
  const statusEl = /** @type {HTMLParagraphElement|null} */ (
    document.getElementById('status')
  );

  if (
    !(syncBtn instanceof HTMLButtonElement) ||
    !(saveBtn instanceof HTMLButtonElement)
  )
    return;

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
    statusEl.className =
      'text-xs mt-3 ' +
      (tone === 'error'
        ? 'text-red-600 dark:text-red-400'
        : 'text-gray-600 dark:text-gray-400');
  }

  async function sendCommand(command) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: command }, (res) => resolve(res));
      } catch (_) {
        resolve(null);
      }
    });
  }

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    setStatus('Syncing…');
    await sendCommand('performSync');
    setStatus('');
    syncBtn.disabled = false;
    window.close();
  });

  async function getHighlightedTabCount() {
    try {
      const tabs = await new Promise((resolve) =>
        chrome.tabs.query(
          { windowId: chrome.windows.WINDOW_ID_CURRENT, highlighted: true },
          (ts) => resolve(ts || []),
        ),
      );
      return Array.isArray(tabs) ? tabs.length : 0;
    } catch (_) {
      return 0;
    }
  }

  (async () => {
    const count = await getHighlightedTabCount();
    saveBtn.textContent = count > 1 ? `Save ${count} tabs` : 'Save';
  })();

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setStatus('Saving…');
    await sendCommand('saveCurrentOrHighlightedTabsToRaindrop');
    setStatus('');
    saveBtn.disabled = false;
    window.close();
  });
})();
