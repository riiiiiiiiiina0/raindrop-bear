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
  const statusEl = /** @type {HTMLParagraphElement|null} */ (
    document.getElementById('status')
  );
  const projectsListEl = /** @type {HTMLUListElement|null} */ (
    document.getElementById('projects-list')
  );

  if (
    !(syncBtn instanceof HTMLButtonElement) ||
    !(saveBtn instanceof HTMLButtonElement) ||
    !(saveProjectBtn instanceof HTMLButtonElement)
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
        ? `🔼 Save ${count} tabs as project`
        : '🔼 Save current window as project';

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
              'pl-4 pr-1 py-1 text-sm hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center justify-between gap-2 cursor-pointer';

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
            addBtn.textContent = '🆕';
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

            const replaceBtn = document.createElement('button');
            replaceBtn.type = 'button';
            replaceBtn.title = 'Replace with current tabs';
            replaceBtn.textContent = '⏫';
            replaceBtn.className =
              'p-1 text-xs rounded bg-transparent transition-colors hover:bg-black cursor-pointer';
            replaceBtn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();

              const highlightedTabs = await getHighlightedTabs();
              const count = highlightedTabs.length;
              const replaceWithHighlighted = count > 1;

              const ok = confirm(
                `Replace project "${String(
                  it.title || 'Untitled',
                )}" with ${
                  replaceWithHighlighted
                    ? `${count} highlighted tabs`
                    : 'tabs in current window'
                }?`,
              );
              if (!ok) return;

              disableAllButtons();
              setStatus('Replacing…');
              if (replaceWithHighlighted) {
                await sendCommand('replaceSavedProject', {
                  id: it.id,
                  useHighlighted: true,
                });
              } else {
                await sendCommand('replaceSavedProject', {
                  id: it.id,
                  useHighlighted: false,
                });
              }
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
              await sendCommand('recoverSavedProjectInNewWindow', {
                id: it.id,
              });
              window.close();
            });

            function disableAllButtons() {
              addBtn.disabled = true;
              deleteBtn.disabled = true;
              replaceBtn.disabled = true;
              openInNewBtn.disabled = true;
              li.classList.add('opacity-60');
            }

            right.appendChild(addBtn);
            right.appendChild(openInNewBtn);
            right.appendChild(replaceBtn);
            right.appendChild(deleteBtn);
            right.classList.add('hidden');

            li.appendChild(left);
            li.appendChild(right);
            li.addEventListener('mouseenter', () => {
              right.classList.remove('hidden');
              li.classList.add('bg-gray-200', 'dark:bg-gray-800');
            });
            li.addEventListener('mouseleave', () => {
              right.classList.add('hidden');
              li.classList.remove('bg-gray-200', 'dark:bg-gray-800');
            });
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

    const highlightedTabs = await getHighlightedTabs();
    const saveHighlighted = highlightedTabs.length > 1;

    const suggested = await computeSuggestedProjectName({
      highlightedOnly: saveHighlighted,
    });
    const name = prompt('Project name?', suggested || undefined);
    if (name && name.trim()) {
      if (saveHighlighted) {
        await sendCommand('saveHighlightedTabsAsProject', {
          name: name.trim(),
        });
      } else {
        await sendCommand('saveWindowAsProject', {
          name: name.trim(),
        });
      }
    }
    setStatus('');
    saveProjectBtn.disabled = false;
    window.close();
  });

})();
