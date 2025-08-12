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
  const projectsListEl = /** @type {HTMLUListElement|null} */ (
    document.getElementById('projects-list')
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
    const hasText = !!(text && String(text).trim());
    statusEl.textContent = hasText ? String(text) : '';
    if (!hasText) {
      statusEl.className =
        'hidden fixed top-0 left-0 right-0 z-10 px-3 py-1.5 text-[11px] leading-4 border-b border-gray-200/60 bg-white/80 text-gray-700 backdrop-blur dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200';
      return;
    }
    if (tone === 'error') {
      statusEl.className =
        'fixed top-0 left-0 right-0 z-10 px-3 py-1.5 text-[11px] leading-4 border-b border-red-200/60 bg-red-50 text-red-700 backdrop-blur dark:border-red-900 dark:bg-red-950/70 dark:text-red-300';
    } else {
      statusEl.className =
        'fixed top-0 left-0 right-0 z-10 px-3 py-1.5 text-[11px] leading-4 border-b border-gray-200/60 bg-white/80 text-gray-700 backdrop-blur dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-200';
    }
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
    setStatus('Syncing');
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
    saveBtn.textContent =
      count === 1 ? '⬆️ Save to unsorted' : `⬆️ Save ${count} tabs to unsorted`;
    saveProjectBtn.textContent =
      count === 1 ? '💾 Save as project' : `💾 Save ${count} tabs as project`;
    saveWindowProjectBtn.textContent = '💾 Save current window as project';

    // Load saved projects list
    try {
      if (projectsListEl instanceof HTMLUListElement) {
        projectsListEl.innerHTML = '';
        const loading = document.createElement('li');
        loading.className =
          'px-4 py-2 text-xs text-gray-500 dark:text-gray-400';
        loading.textContent = 'Loading …';
        projectsListEl.appendChild(loading);

        const res = await sendCommand('listSavedProjects');
        const items =
          res && res.ok && Array.isArray(res.items) ? res.items : [];

        projectsListEl.innerHTML = '';
        if (items.length === 0) {
          const li = document.createElement('li');
          li.className = 'px-4 py-2 text-xs text-gray-500 dark:text-gray-400';
          li.textContent = 'No saved projects';
          projectsListEl.appendChild(li);
        } else {
          for (const it of items) {
            const li = document.createElement('li');
            li.className =
              'px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 flex items-center justify-between gap-2 cursor-pointer';

            const left = document.createElement('div');
            left.className = 'flex min-w-0 items-center gap-2';
            const title = document.createElement('span');
            title.className = 'truncate';
            title.textContent = String(it.title || 'Untitled');
            // const meta = document.createElement('span');
            // meta.className = 'shrink-0 text-[10px] text-gray-400';
            // const parts = [];
            // if (typeof it.count === 'number') parts.push(`${it.count}`);
            // if (it.lastUpdate)
            //   parts.push(new Date(it.lastUpdate).toLocaleDateString());
            // meta.textContent = parts.join(' · ');
            left.appendChild(title);
            // left.appendChild(meta);

            const right = document.createElement('div');
            right.className = 'flex items-center gap-1';

            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button';
            replaceBtn.title = 'Replace';
            replaceBtn.textContent = '🔼';
            replaceBtn.className =
              'px-2 py-1 text-xs rounded bg-amber-300 text-white hover:bg-black hover:text-white cursor-pointer';
            replaceBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              replaceBtn.disabled = true;
              li.classList.add('opacity-60');
              setStatus('Replacing…');
              await sendCommand('replaceSavedProject', { id: it.id });
              window.close();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.title = 'Delete';
            deleteBtn.textContent = '❌';
            deleteBtn.className =
              'px-2 py-1 text-xs rounded bg-red-300 text-white hover:bg-black hover:text-white cursor-pointer';
            deleteBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteBtn.disabled = true;
              li.classList.add('opacity-60');
              setStatus('Deleting…');
              await sendCommand('deleteSavedProject', { id: it.id });
              window.close();
            });

            right.appendChild(replaceBtn);
            right.appendChild(deleteBtn);

            li.appendChild(left);
            li.appendChild(right);
            li.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              setStatus('Recovering project…');
              await sendCommand('recoverSavedProject', { id: it.id });
              window.close();
            });
            projectsListEl.appendChild(li);
          }
        }
      }
    } catch (_) {}
  })();

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setStatus('Saving');
    await sendCommand('saveCurrentOrHighlightedTabsToRaindrop');
    setStatus('');
    saveBtn.disabled = false;
    window.close();
  });

  saveProjectBtn.addEventListener('click', async () => {
    saveProjectBtn.disabled = true;
    setStatus('Saving');
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
    setStatus('Saving');
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
