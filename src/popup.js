(() => {
  const syncBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('sync-btn')
  );
  const saveBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-btn')
  );
  const saveClipboardBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('save-clipboard-btn')
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
    !(saveClipboardBtn instanceof HTMLButtonElement) ||
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
      const eligible = arr.filter((t) => t.url);
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
          const isZeroTabs = it.count === 0;
          li.className = `pl-4 pr-1 py-1 h-9 text-sm flex justify-between gap-2 group border-t border-gray-100 dark:border-gray-800 ${
            isZeroTabs
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer'
          }`;

          const left = document.createElement('div');
          left.className = 'flex min-w-0 items-center gap-2';

          const avatarLink = document.createElement('a');
          avatarLink.href = `https://app.raindrop.io/my/${it.id}`;
          avatarLink.title = 'Open project in raindrop';
          avatarLink.className =
            'relative h-4 w-4 rounded object-cover flex-none';
          avatarLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            chrome.tabs.create({ url: avatarLink.href });
          });

          // Avatar (cover image)
          const avatar = document.createElement('img');
          avatar.className =
            'absolute inset-0 h-full w-full rounded object-cover group-hover:opacity-0 transition-opacity';
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
          avatarLink.appendChild(avatar);

          const globeSpan = document.createElement('span');
          globeSpan.className =
            'absolute inset-0 h-full w-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs';
          globeSpan.textContent = '🌐';
          avatarLink.appendChild(globeSpan);

          const title = document.createElement('span');
          title.className = 'truncate';
          title.textContent = String(it.title || 'Untitled');
          left.appendChild(avatarLink);
          left.appendChild(title);

          const rightContainer = document.createElement('div');
          rightContainer.className = 'flex-none text-right';

          const meta = document.createElement('div');
          {
            // Determine opacity based on age of lastUpdate
            let opacityClass = 'opacity-20';
            if (it.lastUpdate) {
              const now = Date.now();
              const updated = new Date(it.lastUpdate).getTime();
              const diffMs = now - updated;
              const oneDay = 24 * 60 * 60 * 1000;
              const oneWeek = 7 * oneDay;
              const oneMonth = 30 * oneDay;
              if (diffMs <= oneDay) {
                opacityClass = 'opacity-80';
              } else if (diffMs <= oneWeek) {
                opacityClass = 'opacity-60';
              } else if (diffMs <= oneMonth) {
                opacityClass = 'opacity-40';
              }
            }
            meta.className = `group-hover:hidden text-gray-900 dark:text-gray-100 ${opacityClass}`;
          }

          const timeSpan = document.createElement('div');
          timeSpan.className = 'text-[8px]';
          if (it.lastUpdate) {
            const d = new Date(it.lastUpdate);
            const now = new Date();
            const HH = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');

            // Get local date parts
            const dYear = d.getFullYear();
            const dMonth = d.getMonth();
            const dDate = d.getDate();

            const nowYear = now.getFullYear();
            const nowMonth = now.getMonth();
            const nowDate = now.getDate();

            // Calculate difference in days
            const msPerDay = 24 * 60 * 60 * 1000;
            // Zero out time for both dates
            const dMidnight = new Date(dYear, dMonth, dDate);
            const nowMidnight = new Date(nowYear, nowMonth, nowDate);
            const diffDays = Math.round(
              (nowMidnight.getTime() - dMidnight.getTime()) / msPerDay,
            );

            if (dYear === nowYear && dMonth === nowMonth && dDate === nowDate) {
              // Same day
              timeSpan.textContent = `Today ${HH}:${mm}`;
            } else if (diffDays === 1) {
              // Yesterday
              timeSpan.textContent = `Yesterday ${HH}:${mm}`;
            } else if (diffDays > 1 && diffDays < 7) {
              // Within a week
              timeSpan.textContent = `${diffDays} days ago ${HH}:${mm}`;
            } else {
              // Others
              const MM = String(dMonth + 1).padStart(2, '0');
              const DD = String(dDate).padStart(2, '0');
              timeSpan.textContent = `${MM}/${DD} ${HH}:${mm}`;
            }
          }

          const countSpan = document.createElement('div');
          countSpan.className = 'text-[10px]';
          if (typeof it.count === 'number') {
            countSpan.textContent = `${it.count} tab${
              it.count === 1 ? '' : 's'
            }`;
          }

          if (timeSpan.textContent) meta.appendChild(timeSpan);
          if (countSpan.textContent) meta.appendChild(countSpan);
          rightContainer.appendChild(meta);

          const right = document.createElement('div');

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

          const archiveBtn = document.createElement('button');
          archiveBtn.type = 'button';
          archiveBtn.title = 'Archive';
          archiveBtn.textContent = '📥';
          archiveBtn.className =
            'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
          archiveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Optimistically update the cache
            try {
              const CACHE_KEY = 'cached-projects-list';
              const cached = await new Promise((resolve) =>
                chrome.storage.local.get(CACHE_KEY, (r) => resolve(r)),
              );
              if (cached && Array.isArray(cached[CACHE_KEY])) {
                const updatedItems = cached[CACHE_KEY].filter(
                  (item) => item.id !== it.id,
                );
                await new Promise((resolve) =>
                  chrome.storage.local.set({ [CACHE_KEY]: updatedItems }, () =>
                    resolve(),
                  ),
                );
              }
            } catch (_) {
              // Ignore cache update errors
            }

            disableAllButtons();
            setStatus('Archiving…');
            await sendCommand('archiveProject', { id: it.id });
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

          function disableAllButtons() {
            addBtn.disabled = true;
            deleteBtn.disabled = true;
            replaceWithHighlightedBtn.disabled = true;
            replaceWithWindowBtn.disabled = true;
            archiveBtn.disabled = true;
            li.classList.add('opacity-60');
          }

          right.className = 'flex items-center gap-1 hidden group-hover:flex';
          right.appendChild(addBtn);
          right.appendChild(replaceWithHighlightedBtn);
          right.appendChild(replaceWithWindowBtn);
          right.appendChild(archiveBtn);
          right.appendChild(deleteBtn);
          rightContainer.appendChild(right);

          li.appendChild(left);
          li.appendChild(rightContainer);
          if (!isZeroTabs) {
            li.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();

              const openInNewWindow = e.shiftKey || e.metaKey;
              if (openInNewWindow) {
                setStatus('Recovering project in new window…');
                await sendCommand('recoverSavedProjectInNewWindow', {
                  id: it.id,
                  title: it.title,
                });
              } else {
                setStatus('Recovering project…');
                await sendCommand('recoverSavedProject', {
                  id: it.id,
                  title: it.title,
                });
              }
              window.close();
            });
          }
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

  /**
   * @param {string} str
   * @returns {boolean}
   */
  function isValidHttpUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  saveClipboardBtn.addEventListener('click', async () => {
    if (navigator.clipboard) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && isValidHttpUrl(text)) {
          saveClipboardBtn.disabled = true;
          setStatus('Saving from clipboard…');
          await sendCommand('saveUrlToUnsorted', { url: text, title: text });
          setStatus('');
          saveClipboardBtn.disabled = false;
          window.close();
        } else {
          setStatus('No URL found in clipboard.', 'error');
        }
      } catch (err) {
        console.error('Failed to read clipboard contents: ', err);
        setStatus('Failed to read clipboard.', 'error');
      }
    }
  });
})();
