import { apiGET, apiDELETEWithBody } from './modules/raindrop.js';
import { fetchGroupsAndCollections } from './modules/collections.js';

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

  const findDuplicatesEl = /** @type {HTMLButtonElement} */ (
    document.getElementById('find-duplicates')
  );
  const duplicatesContainerEl = /** @type {HTMLDivElement} */ (
    document.getElementById('duplicates-container')
  );

  if (
    !(findDuplicatesEl instanceof HTMLButtonElement) ||
    !(duplicatesContainerEl instanceof HTMLDivElement)
  ) {
    return;
  }

  async function findAndDisplayDuplicates() {
    findDuplicatesEl.disabled = true;
    duplicatesContainerEl.innerHTML =
      '<p class="text-sm">Finding duplicates...</p>';

    try {
      const { rootCollections, childCollections } =
        await fetchGroupsAndCollections();
      const collectionIdToName = new Map();
      for (const c of [...rootCollections, ...childCollections]) {
        collectionIdToName.set(c._id, c.title);
      }

      let allRaindrops = [];
      let page = 0;
      while (true) {
        const res = await apiGET(`/raindrops/0?perpage=50&page=${page}`);
        if (res.items.length === 0) {
          break;
        }
        allRaindrops.push(...res.items);
        page++;
      }

      const raindropsByCollection = new Map();
      for (const r of allRaindrops) {
        const collectionId = r.collection.$id;
        if (!raindropsByCollection.has(collectionId)) {
          raindropsByCollection.set(collectionId, []);
        }
        raindropsByCollection.get(collectionId).push(r);
      }

      let duplicatesByCollection = new Map();
      for (const [collectionId, raindrops] of raindropsByCollection.entries()) {
        raindrops.sort(
          (a, b) => new Date(a.lastUpdate) - new Date(b.lastUpdate),
        );
        const seenUrls = new Set();
        const collectionDuplicates = [];
        for (const raindrop of raindrops) {
          if (seenUrls.has(raindrop.link)) {
            collectionDuplicates.push(raindrop);
          } else {
            seenUrls.add(raindrop.link);
          }
        }

        if (collectionDuplicates.length > 0) {
          const collectionName =
            collectionIdToName.get(collectionId) ||
            `Collection ${collectionId}`;
          duplicatesByCollection.set(collectionId, {
            name: collectionName,
            duplicates: collectionDuplicates,
          });
        }
      }

      if (duplicatesByCollection.size === 0) {
        duplicatesContainerEl.innerHTML =
          '<p class="text-sm">No duplicates found.</p>';
        return;
      }

      let html = '';
      let allDuplicateIds = [];
      for (const [
        collectionId,
        { name, duplicates },
      ] of duplicatesByCollection.entries()) {
        html += `<h3 class="text-lg font-medium mt-4">${name}</h3>`;
        html += '<ul class="list-disc list-inside">';
        for (const dup of duplicates) {
          html += `<li class="text-sm"><a href="${dup.link}" target="_blank" class="text-blue-600 hover:underline dark:text-blue-400">${dup.title}</a></li>`;
          allDuplicateIds.push(dup._id);
        }
        html += '</ul>';
      }

      html += `<button id="remove-duplicates" class="mt-4 inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-white shadow-sm transition cursor-pointer hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60">Remove ${allDuplicateIds.length} Duplicates</button>`;
      duplicatesContainerEl.innerHTML = html;

      const removeButton = /** @type {HTMLButtonElement} */ (
        document.getElementById('remove-duplicates')
      );
      if (removeButton) {
        removeButton.addEventListener('click', async () => {
          removeButton.disabled = true;
          removeButton.textContent = 'Removing...';

          const duplicateIdsByCollection = new Map();
          for (const [
            collectionId,
            { duplicates },
          ] of duplicatesByCollection.entries()) {
            const ids = duplicates.map((d) => d._id);
            duplicateIdsByCollection.set(collectionId, ids);
          }

          for (const [
            collectionId,
            ids,
          ] of duplicateIdsByCollection.entries()) {
            await apiDELETEWithBody(`/raindrops/${collectionId}`, { ids });
          }

          // @ts-ignore
          Toastify({
            text: '✅ Duplicates removed successfully',
            duration: 3000,
            position: 'right',
            style: { background: '#22c55e' },
          }).showToast();
          duplicatesContainerEl.innerHTML = '';
        });
      }
    } catch (error) {
      duplicatesContainerEl.innerHTML = `<p class="text-sm text-red-600 dark:text-red-400">Error: ${error.message}</p>`;
    } finally {
      findDuplicatesEl.disabled = false;
    }
  }

  findDuplicatesEl.addEventListener('click', findAndDisplayDuplicates);

  // removed action button preferences
  load();
})();
