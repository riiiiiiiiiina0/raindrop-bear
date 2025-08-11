(() => {
  const syncBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('sync-btn')
  );
  const saveBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-btn')
  );
  const saveProjectBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-project-btn')
  );
  const saveWindowProjectBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-window-project-btn')
  );
  const statusEl = /** @type {HTMLParagraphElement|null} */ (
    document.getElementById('status')
  );

  if (
    !(syncBtn instanceof HTMLButtonElement) ||
    !(saveBtn instanceof HTMLButtonElement) ||
    !(saveProjectBtn instanceof HTMLButtonElement) ||
    !(saveWindowProjectBtn instanceof HTMLButtonElement)
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

  async function sendCommand(command, payload) {
    return new Promise((resolve) => {
      try {
        const message = Object.assign({ type: command }, payload || {});
        chrome.runtime.sendMessage(message, (res) => resolve(res));
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function computeSuggestedProjectName(options) {
    const highlightedOnly = !!(options && options.highlightedOnly);
    try {
      const windowId = chrome.windows.WINDOW_ID_CURRENT;
      const tabs = await new Promise((resolve) =>
        chrome.tabs.query(
          highlightedOnly ? { windowId, highlighted: true } : { windowId },
          (ts) => resolve(ts || []),
        ),
      );
      const arr = Array.isArray(tabs) ? tabs : [];
      const eligible = arr.filter(
        (t) =>
          t.url &&
          (t.url.startsWith('https://') || t.url.startsWith('http://')),
      );
      const targetTabs = eligible.length > 0 ? eligible : arr;
      if (targetTabs.length === 0) return '';

      const groupsInWindow = await new Promise((resolve) =>
        chrome.tabGroups?.query({ windowId }, (gs) => resolve(gs || [])),
      );
      const map = new Map();
      (Array.isArray(groupsInWindow) ? groupsInWindow : []).forEach((g) => {
        map.set(g.id, g);
      });
      const titlesSet = new Set();
      targetTabs.forEach((t) => {
        const g = map.get(t.groupId);
        if (g && g.title) titlesSet.add(g.title);
      });
      const titles = Array.from(titlesSet);
      if (titles.length > 0) return titles.join(', ');

      const first = targetTabs[0];
      const firstTitle = (first && first.title) || '';
      if (firstTitle) return firstTitle;
      try {
        const u = new URL(first && first.url ? first.url : '');
        if (u && u.host) return u.host;
      } catch (_) {}
      return 'Project';
    } catch (_) {
      return '';
    }
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
    const tabLabel = count === 1 ? 'tab' : 'tabs';
    saveBtn.textContent =
      count > 0
        ? `⬆️ Save ${count} ${tabLabel} to Unsorted`
        : '⬆️ Save to Unsorted';
    saveProjectBtn.textContent =
      count > 0
        ? `💾 Save ${count} ${tabLabel} as project`
        : '💾 Save as project';
    saveWindowProjectBtn.textContent = '💾 Save current window as project';
  })();

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setStatus('Saving…');
    await sendCommand('saveCurrentOrHighlightedTabsToRaindrop');
    setStatus('');
    saveBtn.disabled = false;
    window.close();
  });

  saveProjectBtn.addEventListener('click', async () => {
    saveProjectBtn.disabled = true;
    setStatus('Saving…');
    const suggested = await computeSuggestedProjectName({
      highlightedOnly: true,
    });
    const name = prompt('Project name?', suggested || undefined);
    if (name && name.trim()) {
      await sendCommand('saveHighlightedTabsAsProject', {
        name: name.trim(),
      });
    }
    setStatus('');
    saveProjectBtn.disabled = false;
    window.close();
  });

  saveWindowProjectBtn.addEventListener('click', async () => {
    saveWindowProjectBtn.disabled = true;
    setStatus('Saving…');
    const suggested = await computeSuggestedProjectName({
      highlightedOnly: false,
    });
    const name = prompt('Project name?', suggested || undefined);
    if (name && name.trim()) {
      await sendCommand('saveCurrentWindowAsProject', {
        name: name.trim(),
      });
    }
    setStatus('');
    saveWindowProjectBtn.disabled = false;
    window.close();
  });
})();
