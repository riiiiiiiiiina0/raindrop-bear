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
  const actionSingleEl = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('action-single')
  );
  const actionDoubleEl = /** @type {HTMLSelectElement|null} */ (
    document.getElementById('action-double')
  );
  const tabsSyncEnabledEl = /** @type {HTMLInputElement|null} */ (
    document.getElementById('tabs-sync-enabled')
  );
  const tabsGroupTitleEl = /** @type {HTMLInputElement|null} */ (
    document.getElementById('tabs-group-title')
  );

  if (
    !(formEl instanceof HTMLFormElement) ||
    !(tokenEl instanceof HTMLInputElement) ||
    !(saveEl instanceof HTMLButtonElement) ||
    !(statusEl instanceof HTMLSpanElement) ||
    !(notifyEl instanceof HTMLInputElement) ||
    !(notifyStatusEl instanceof HTMLSpanElement) ||
    !(actionSingleEl instanceof HTMLSelectElement) ||
    !(actionDoubleEl instanceof HTMLSelectElement) ||
    !(tabsSyncEnabledEl instanceof HTMLInputElement) ||
    !(tabsGroupTitleEl instanceof HTMLInputElement)
  ) {
    // DOM not ready; abort quietly
    return;
  }

  function load() {
    try {
      chrome.storage.local.get(
        [
          'raindropApiToken',
          'notifyOnSync',
          'actionSingle',
          'actionDouble',
          'actionBehavior',
          'tabsSyncEnabled',
          'tabsGroupTitle',
        ],
        (data) => {
          if (tokenEl) tokenEl.value = (data && data.raindropApiToken) || '';
          const notifyEnabled =
            data && typeof data.notifyOnSync === 'boolean'
              ? data.notifyOnSync
              : true; // default ON
          if (notifyEl) notifyEl.checked = !!notifyEnabled;
          const single =
            (data && data.actionSingle) ||
            (data && data.actionBehavior) ||
            'sync';
          const double = (data && data.actionDouble) || 'save';
          if (actionSingleEl) actionSingleEl.value = single;
          if (actionDoubleEl) actionDoubleEl.value = double;

          // Tabs sync
          const tabsSyncEnabled =
            data && typeof data.tabsSyncEnabled === 'boolean'
              ? data.tabsSyncEnabled
              : true; // default ON
          if (tabsSyncEnabledEl) tabsSyncEnabledEl.checked = !!tabsSyncEnabled;
          if (tabsGroupTitleEl)
            tabsGroupTitleEl.value = (data && data.tabsGroupTitle) || '';
        },
      );
    } catch (_) {}
  }

  function save() {
    if (saveEl) saveEl.disabled = true;
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

  // action single-click: save immediately
  if (actionSingleEl)
    actionSingleEl.addEventListener('change', () => {
      const value = actionSingleEl.value || 'sync';
      try {
        chrome.storage.local.set({ actionSingle: value }, () => {
          try {
            /** @type {any} */ (window)
              .Toastify({
                text: '⚙️ Single-click action saved',
                duration: 3000,
                position: 'right',
                style: { background: '#64748b' },
              })
              .showToast();
          } catch (_) {}
        });
      } catch (_) {}
    });

  // action double-click: save immediately
  if (actionDoubleEl)
    actionDoubleEl.addEventListener('change', () => {
      const value = actionDoubleEl.value || 'save';
      try {
        chrome.storage.local.set({ actionDouble: value }, () => {
          try {
            /** @type {any} */ (window)
              .Toastify({
                text: '⚙️ Double-click action saved',
                duration: 3000,
                position: 'right',
                style: { background: '#64748b' },
              })
              .showToast();
          } catch (_) {}
        });
      } catch (_) {}
    });

  // tabs sync enabled: save immediately
  if (tabsSyncEnabledEl)
    tabsSyncEnabledEl.addEventListener('change', () => {
      const value = !!tabsSyncEnabledEl.checked;
      try {
        chrome.storage.local.set({ tabsSyncEnabled: value }, () => {
          try {
            /** @type {any} */ (window)
              .Toastify({
                text: '📑 Tabs Sync preference saved',
                duration: 3000,
                position: 'right',
                style: { background: '#3b82f6' },
              })
              .showToast();
          } catch (_) {}
        });
      } catch (_) {}
    });

  // tabs group title: save with debounce
  let groupTitleTimeout;
  if (tabsGroupTitleEl)
    tabsGroupTitleEl.addEventListener('input', () => {
      clearTimeout(groupTitleTimeout);
      groupTitleTimeout = setTimeout(() => {
        const value = tabsGroupTitleEl.value.trim();
        try {
          chrome.storage.local.set({ tabsGroupTitle: value }, () => {
            try {
              /** @type {any} */ (window)
                .Toastify({
                  text: '📑 Tabs Group Title saved',
                  duration: 3000,
                  position: 'right',
                  style: { background: '#3b82f6' },
                })
                .showToast();
            } catch (_) {}
          });
        } catch (_) {}
      }, 500);
    });

  load();
})();
