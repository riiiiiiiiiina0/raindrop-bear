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
  const settingsBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('settings-btn')
  );
  const raindropBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('raindrop-btn')
  );
  const projectsRefreshingStatusEl = /** @type {HTMLSpanElement|null} */ (
    document.getElementById('projects-refreshing-status')
  );

  if (
    !(syncBtn instanceof HTMLButtonElement) ||
    !(saveBtn instanceof HTMLButtonElement) ||
    !(saveProjectBtn instanceof HTMLButtonElement) ||
    !(settingsBtn instanceof HTMLButtonElement) ||
    !(raindropBtn instanceof HTMLButtonElement) ||
    !(saveWindowProjectBtn instanceof HTMLButtonElement)
  )
    return;

  /**
   * @param {string} text
   * @param {'info'|'error'} [tone]
   */
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

  async function getHighlightedTabs() {
    try {
      const tabs = await new Promise((resolve) =>
        chrome.tabs.query(
          { windowId: chrome.windows.WINDOW_ID_CURRENT, highlighted: true },
          (ts) => resolve(ts || []),
        ),
      );
      return Array.isArray(tabs) ? tabs : [];
    } catch (_) {
      return [];
    }
  }

  (async () => {
    const highlightedTabs = await getHighlightedTabs();
    const count = highlightedTabs.length;
    saveBtn.textContent =
      count === 1 ? '📥 Save to unsorted' : `📥 Save ${count} tabs to unsorted`;
    saveProjectBtn.textContent =
      count > 1
        ? `🔼 Save ${count} highlighted tabs as project`
        : '🔼 Save current tab as project';

    /** @param {any[]} items */
    function renderProjects(items) {
      if (!(projectsListEl instanceof HTMLUListElement)) return;
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
            'pl-4 pr-1 py-1 h-8 text-sm hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center justify-between gap-2 cursor-pointer group';

          const left = document.createElement('div');
          left.className = 'flex min-w-0 items-center gap-2';

          // Avatar (cover image)
          const avatar = document.createElement('img');
          avatar.className = 'h-4 w-4 rounded object-cover flex-none';
          const cover = (it && it.cover) || '';
          if (cover) {
            avatar.src = String(cover);
            avatar.alt = '';
          } else {
            // tiny transparent placeholder to keep layout consistent
            avatar.src =
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
            avatar.alt = '';
          }

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
          left.appendChild(avatar);
          left.appendChild(title);
          // left.appendChild(meta);

          const right = document.createElement('div');
          right.className = 'flex items-center gap-1';

          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.title = 'Add current tab(s) to this project';
          addBtn.textContent = '➕';
          addBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          addBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            disableAllButtons();
            setStatus('Adding tabs…');
            await sendCommand('addTabsToProject', { id: it.id });
            window.close();
          });

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.title = 'Delete';
          deleteBtn.textContent = '❌';
          deleteBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          deleteBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = confirm(
              `Delete saved project "${String(it.title || 'Untitled')}"?`,
            );
            if (!ok) return;
            disableAllButtons();
            setStatus('Deleting…');
            await sendCommand('deleteSavedProject', { id: it.id });
            window.close();
          });

          const replaceWithHighlightedBtn = document.createElement('button');
          replaceWithHighlightedBtn.type = 'button';
          if (count > 1) {
            replaceWithHighlightedBtn.title = `Replace with ${count} highlighted tabs`;
          } else {
            replaceWithHighlightedBtn.title = `Replace with current tab`;
          }
          replaceWithHighlightedBtn.textContent = '🔼';
          replaceWithHighlightedBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          replaceWithHighlightedBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = confirm(
              `Replace project "${String(it.title || 'Untitled')}" with ${
                count > 1 ? `${count} highlighted tabs` : 'the current tab'
              }?`,
            );
            if (!ok) return;
            disableAllButtons();
            setStatus('Replacing…');
            await sendCommand('replaceSavedProject', {
              id: it.id,
              useHighlighted: true,
            });
            window.close();
          });

          const replaceWithWindowBtn = document.createElement('button');
          replaceWithWindowBtn.type = 'button';
          replaceWithWindowBtn.title = 'Replace with current window';
          replaceWithWindowBtn.textContent = '⏫';
          replaceWithWindowBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          replaceWithWindowBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const ok = confirm(
              `Replace project "${String(
                it.title || 'Untitled',
              )}" with tabs in the current window?`,
            );
            if (!ok) return;
            disableAllButtons();
            setStatus('Replacing…');
            await sendCommand('replaceSavedProject', {
              id: it.id,
              useHighlighted: false,
            });
            window.close();
          });

          const openInNewBtn = document.createElement('button');
          openInNewBtn.type = 'button';
          openInNewBtn.title = 'Open in new window';
          openInNewBtn.textContent = '↗️';
          openInNewBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          openInNewBtn.addEventListener('click', async (e) => {
              e.preventDefault();
            e.stopPropagation();
            disableAllButtons();
            setStatus('Recovering project in new window…');
            await sendCommand('recoverSavedProjectInNewWindow', { id: it.id });
            window.close();
          });

          const openInRaindropBtn = document.createElement('button');
          openInRaindropBtn.type = 'button';
          openInRaindropBtn.title = 'Open collection in Raindrop.io';
          openInRaindropBtn.textContent = '🌐';
          openInRaindropBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          openInRaindropBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const url = `https://app.raindrop.io/my/${it.id}`;
            chrome.tabs.create({ url });
          });

          function disableAllButtons() {
            addBtn.disabled = true;
            deleteBtn.disabled = true;
            replaceWithHighlightedBtn.disabled = true;
            replaceWithWindowBtn.disabled = true;
            openInNewBtn.disabled = true;
            openInRaindropBtn.disabled = true;
            li.classList.add('opacity-60');
          }

          right.className = 'flex items-center gap-1 hidden group-hover:flex';
          right.appendChild(addBtn);
          right.appendChild(replaceWithHighlightedBtn);
          right.appendChild(replaceWithWindowBtn);
          right.appendChild(openInNewBtn);
          right.appendChild(openInRaindropBtn);
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

    // Load saved projects list
    try {
      if (projectsListEl instanceof HTMLUListElement) {
        const CACHE_KEY = 'cached-projects-list';
        let hasRenderedFromCache = false;

        // Try to load from cache first
        try {
          const cached = await new Promise((resolve) =>
            chrome.storage.local.get(CACHE_KEY, (r) => resolve(r)),
          );
          if (cached && Array.isArray(cached[CACHE_KEY])) {
            renderProjects(cached[CACHE_KEY]);
            hasRenderedFromCache = true;
            if (projectsRefreshingStatusEl)
              projectsRefreshingStatusEl.classList.remove('hidden');
          }
        } catch (_) {}

        if (!hasRenderedFromCache) {
          projectsListEl.innerHTML = '';
          const loading = document.createElement('li');
          loading.className =
            'px-4 py-2 text-xs text-gray-500 dark:text-gray-400';
          loading.textContent = 'Loading …';
          projectsListEl.appendChild(loading);
        }

        const res = await sendCommand('listSavedProjects');
        const items =
          res && res.ok && Array.isArray(res.items) ? res.items : [];
        renderProjects(items);
        if (projectsRefreshingStatusEl)
          projectsRefreshingStatusEl.classList.add('hidden');

        // Update cache
        try {
          await new Promise((resolve) =>
            chrome.storage.local.set({ [CACHE_KEY]: items }, () => resolve()),
          );
        } catch (_) {}
      }
    } catch (_) {
      if (projectsRefreshingStatusEl)
        projectsRefreshingStatusEl.classList.add('hidden');
    }
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
      highlightedOnly: false, // For the whole window
    });
    const name = prompt('Project name?', suggested || undefined);
    if (name && name.trim()) {
      await sendCommand('saveWindowAsProject', {
        name: name.trim(),
      });
    }
    setStatus('');
    saveWindowProjectBtn.disabled = false;
    window.close();
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  raindropBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://app.raindrop.io/my/-1' });
  });
})();
