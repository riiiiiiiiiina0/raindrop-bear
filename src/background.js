// Raindrop Bear Background Service Worker (Manifest V3) – modular orchestration
import {
  apiGET,
  apiPOST,
  apiPUT,
  apiDELETE,
  apiGETText,
  setFacadeToken,
} from './modules/api-facade.js';
import {
  notifyMissingOrInvalidToken,
  TOKEN_NOTIFICATION_ID,
  notifySyncFailure,
  notifySyncSuccess,
  SYNC_SUCCESS_NOTIFICATION_ID,
  notify,
} from './modules/notifications.js';
import {
  ROOT_FOLDER_NAME,
  UNSORTED_COLLECTION_ID,
  getOrCreateRootFolder as bmGetOrCreateRootFolder,
  getOrCreateChildFolder as bmGetOrCreateChildFolder,
  getBookmarksBarFolderId,
  removeLegacyTopFolders,
} from './modules/bookmarks.js';
import { chromeP } from './modules/chrome.js';
import {
  setBadge,
  clearBadge,
  scheduleClearBadge,
  setActionTitle,
  flashBadge,
} from './modules/ui.js';
import { STORAGE_KEYS, loadState, saveState } from './modules/state.js';
import {
  fetchGroupsAndCollections,
  buildCollectionsIndex,
  buildCollectionToGroupMap,
  computeGroupForCollection,
} from './modules/collections.js';
import {
  getOrCreateRootFolder,
  getOrCreateChildFolder as getOrCreateChildFolderLocal,
  syncFolders,
} from './modules/folder-sync.js';
import {
  extractCollectionId,
  ensureUnsortedFolder,
  syncNewAndUpdatedItems,
  syncDeletedItems,
} from './modules/item-sync.js';
import { ensureRootAndMaybeReset } from './modules/root-ensure.js';
import { invertRecord } from './modules/utils.js';
import {
  isSyncing,
  setIsSyncing,
  suppressLocalBookmarkEvents,
  setSuppressLocalBookmarkEvents,
  recentlyCreatedRemoteUrls,
  rememberRecentlyCreatedRemoteUrls,
} from './modules/shared-state.js';
import {
  ACTIVE_SYNC_SESSIONS_KEY,
  WINDOW_SYNC_ALARM_PREFIX,
  windowSyncSessions,
  loadActiveSyncSessionsIntoMemory,
  persistActiveSyncSessions,
  scheduleWindowSync,
  stopWindowSync,
  createCollectionUnderSavedProjects,
  overrideCollectionWithWindowTabs,
  restoreActionUiForActiveWindow,
  projectNameWithoutPrefix,
  startSyncCurrentWindowAsProject,
  startSyncWindowToExistingProject,
} from './modules/window-sync.js';
import {
  listSavedProjects,
  recoverSavedProject,
  deleteSavedProject,
  saveCurrentOrHighlightedTabsToRaindrop,
  saveHighlightedTabsAsProject,
} from './modules/projects.js';

const ALARM_NAME = 'raindrop-sync';
const SYNC_PERIOD_MINUTES = 10;

async function performSync() {
  if (isSyncing) return;
  setIsSyncing(true);
  setSuppressLocalBookmarkEvents(true);
  let notifyPref = true;
  try {
    const data = await chromeP.storageGet('notifyOnSync');
    if (data && typeof data.notifyOnSync === 'boolean') {
      notifyPref = data.notifyOnSync;
    }
  } catch (_) {}
  let didSucceed = false;
  let hasAnyChanges = false;
  setBadge('🔄', '#38bdf8');
  try {
    let state = await loadState();
    const { didReset, state: updatedState } = await ensureRootAndMaybeReset(
      state,
    );
    if (didReset) state = updatedState;
    const { groups, rootCollections, childCollections } =
      await fetchGroupsAndCollections();
    const SAVED_PROJECTS_TITLE = 'Saved Projects';
    const filteredGroups = (groups || []).filter(
      (g) => (g && g.title) !== SAVED_PROJECTS_TITLE,
    );
    const collectionsById = buildCollectionsIndex(
      rootCollections,
      childCollections,
    );
    const rootCollectionToGroupTitleAll = buildCollectionToGroupMap(
      groups || [],
    );
    for (const id of Array.from(collectionsById.keys())) {
      const groupTitle = computeGroupForCollection(
        id,
        collectionsById,
        rootCollectionToGroupTitleAll,
      );
      if (groupTitle === SAVED_PROJECTS_TITLE) collectionsById.delete(id);
    }
    const { collectionMap, didChange: foldersChanged } = await syncFolders(
      filteredGroups,
      collectionsById,
      state,
    );
    const {
      itemMap: updatedItemMap,
      newLastSyncISO,
      didChange: itemsChanged,
    } = await syncNewAndUpdatedItems(
      state.lastSync,
      collectionMap,
      { ...(state.itemMap || {}) },
      getOrCreateRootFolder,
      getOrCreateChildFolderLocal,
    );
    const { itemMap: prunedItemMap, didChange: deletionsChanged } =
      state.lastSync
        ? await syncDeletedItems(state.lastSync, updatedItemMap, collectionMap)
        : { itemMap: updatedItemMap, didChange: false };
    hasAnyChanges = Boolean(foldersChanged || itemsChanged || deletionsChanged);
    await saveState({
      lastSync: newLastSyncISO,
      collectionMap,
      itemMap: prunedItemMap,
    });
    didSucceed = true;
  } catch (err) {
    console.error(
      'Raindrop sync failed:',
      err && err.message ? err.message : err,
    );
    if (notifyPref) {
      const msg = err && err.message ? String(err.message) : 'Unknown error';
      try {
        notifySyncFailure(`Sync failed: ${msg}`);
      } catch (_) {}
    }
  } finally {
    setSuppressLocalBookmarkEvents(false);
    setIsSyncing(false);
    try {
      clearBadge();
    } catch (_) {}
    flashBadge(didSucceed);
    try {
      await restoreActionUiForActiveWindow(chrome, chromeP);
    } catch (_) {}
    if (didSucceed) {
      let notifyPref2 = true;
      try {
        const data = await chromeP.storageGet('notifyOnSync');
        if (data && typeof data.notifyOnSync === 'boolean')
          notifyPref2 = data.notifyOnSync;
      } catch (_) {}
      if (notifyPref2 && hasAnyChanges) {
        try {
          notifySyncSuccess('Sync completed successfully.');
        } catch (_) {}
      }
    }
  }
}

async function saveUrlToUnsorted(url, title) {
  try {
    const body = {
      link: url,
      title: title || url,
      collection: { $id: UNSORTED_COLLECTION_ID },
      pleaseParse: {},
    };
    await apiPOST('/raindrop', body);
    notify('Link saved to Unsorted!');
    flashBadge(true);
  } catch (err) {
    console.error('Failed to save link to Unsorted:', err);
    notify('Error saving link to Unsorted.');
    flashBadge(false);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
  } catch (_) {}
  try {
    await removeLegacyTopFolders();
  } catch (_) {}

  // Create context menus
  try {
    chrome.contextMenus.create({
      id: 'save-link',
      title: 'Save link to Unsorted',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'save-page',
      title: 'Save page to Unsorted',
      contexts: ['page'],
    });
  } catch (err) {
    console.error('Failed to create context menus:', err);
  }

  if (details && details.reason === 'install') {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      const token = (
        data && data.raindropApiToken ? String(data.raindropApiToken) : ''
      ).trim();
      if (token) {
        setFacadeToken(token);
        performSync();
      } else {
        try {
          chrome.runtime.openOptionsPage();
        } catch (_) {}
      }
    } catch (_) {}
  }
});

// Initialize window sync sessions at SW start
(async () => {
  await loadActiveSyncSessionsIntoMemory(chromeP);
  try {
    await restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
})();

// Local → Raindrop mirroring (guarded by flags in shared-state)
chrome.bookmarks?.onCreated.addListener(async (id, node) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    if (node && node.url && recentlyCreatedRemoteUrls.has(String(node.url)))
      return;
    // Inline mirror logic moved into projects/mirror earlier; for now, reuse minimal subset
    const state = await loadState();
    const rootFolderId = state.rootFolderId;
    if (!rootFolderId) return;
    const underRoot = await (async function isUnderManagedRoot(
      nodeId,
      rootFolderId,
    ) {
      async function getAncestorIds(nodeId) {
        const ids = [];
        let currentId = nodeId;
        const visited = new Set();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          ids.push(String(currentId));
          try {
            const nodes = await chromeP.bookmarksGet(String(currentId));
            const node = nodes && nodes[0];
            if (!node || !node.parentId) break;
            currentId = node.parentId;
          } catch (_) {
            break;
          }
        }
        return ids;
      }
      const ancestors = await getAncestorIds(nodeId);
      return ancestors.includes(String(rootFolderId));
    })(node.parentId, rootFolderId);
    if (!underRoot) return;
    const collectionMap = { ...(state.collectionMap || {}) };
    const collectionByFolder = invertRecord(collectionMap);
    const unsortedFolderId =
      collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
    if (node.url) {
      let collectionId = null;
      if (String(node.parentId) === String(unsortedFolderId))
        collectionId = UNSORTED_COLLECTION_ID;
      else {
        const mapped = collectionByFolder[String(node.parentId)];
        collectionId = mapped != null ? Number(mapped) : UNSORTED_COLLECTION_ID;
      }
      const body = {
        link: node.url,
        title: node.title || node.url,
        collection: { $id: collectionId },
      };
      try {
        const res = await apiPOST('/raindrop', body);
        const item = res && (res.item || res.data || res);
        const newId =
          item && (item._id != null ? String(item._id) : String(item.id || ''));
        if (newId) {
          const itemMap = { ...(state.itemMap || {}) };
          itemMap[newId] = String(id);
          await saveState({ itemMap });
        }
      } catch (_) {}
    } else {
      const parentCollectionId =
        await (async function resolveParentCollectionId(parentFolderId, state) {
          const collectionMap = state.collectionMap || {};
          const groupMap = state.groupMap || {};
          const collectionByFolder = invertRecord(collectionMap);
          const unsortedFolderId =
            collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
          const mapped = collectionByFolder[String(parentFolderId)];
          if (mapped != null && mapped !== '') return Number(mapped);
          if (String(parentFolderId) === String(unsortedFolderId)) return null;
          for (const id of Object.values(groupMap || {})) {
            if (String(id) === String(parentFolderId)) return null;
          }
          if (String(parentFolderId) === String(state.rootFolderId || ''))
            return null;
          return null;
        })(node.parentId, state);
      const body =
        parentCollectionId == null
          ? { title: node.title || '' }
          : { title: node.title || '', parent: { $id: parentCollectionId } };
      try {
        const res = await apiPOST('/collection', body);
        const created = res && (res.item || res.data || res);
        const colId =
          created &&
          (created._id != null
            ? String(created._id)
            : String(created.id || ''));
        if (colId) {
          const newCollectionMap = { ...(state.collectionMap || {}) };
          newCollectionMap[colId] = String(id);
          await saveState({ collectionMap: newCollectionMap });
        }
      } catch (_) {}
    }
  } catch (_) {}
});

chrome.bookmarks?.onRemoved.addListener(async (id) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    const state = await loadState();
    if (state.rootFolderId) {
      try {
        const nodes = await chromeP.bookmarksGet(String(state.rootFolderId));
        if (!nodes || nodes.length === 0) return;
      } catch (_) {
        return;
      }
    }
    const itemMap = { ...(state.itemMap || {}) };
    const collectionMap = { ...(state.collectionMap || {}) };
    const itemByLocal = invertRecord(itemMap);
    const collectionByLocal = invertRecord(collectionMap);
    if (itemByLocal[String(id)]) {
      const raindropId = itemByLocal[String(id)];
      try {
        await apiDELETE(`/raindrop/${encodeURIComponent(raindropId)}`);
      } catch (_) {}
      delete itemMap[String(raindropId)];
      await saveState({ itemMap });
      return;
    }
    if (collectionByLocal[String(id)]) {
      const collectionId = collectionByLocal[String(id)];
      try {
        await apiDELETE(`/collection/${encodeURIComponent(collectionId)}`);
      } catch (_) {}
      delete collectionMap[String(collectionId)];
      await saveState({ collectionMap });
    }
  } catch (_) {}
});

chrome.bookmarks?.onChanged.addListener(async (id, changeInfo) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    const state = await loadState();
    const itemMap = { ...(state.itemMap || {}) };
    const collectionMap = { ...(state.collectionMap || {}) };
    const itemByLocal = invertRecord(itemMap);
    const collectionByLocal = invertRecord(collectionMap);
    if (itemByLocal[String(id)]) {
      const raindropId = itemByLocal[String(id)];
      const body = {};
      if (typeof changeInfo.title === 'string')
        body['title'] = changeInfo.title;
      if (typeof changeInfo.url === 'string') body['link'] = changeInfo.url;
      if (Object.keys(body).length > 0) {
        try {
          await apiPUT(`/raindrop/${encodeURIComponent(raindropId)}`, body);
        } catch (_) {}
      }
      return;
    }
    if (collectionByLocal[String(id)]) {
      const collectionId = collectionByLocal[String(id)];
      if (typeof changeInfo.title === 'string') {
        try {
          await apiPUT(`/collection/${encodeURIComponent(collectionId)}`, {
            title: changeInfo.title,
          });
        } catch (_) {}
      }
    }
  } catch (_) {}
});

chrome.bookmarks?.onMoved.addListener(async (id, moveInfo) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    const state = await loadState();
    const rootFolderId = state.rootFolderId;
    if (!rootFolderId) return;
    const underRoot = await (async function isUnderManagedRoot(
      nodeId,
      rootFolderId,
    ) {
      async function getAncestorIds(nodeId) {
        const ids = [];
        let currentId = nodeId;
        const visited = new Set();
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          ids.push(String(currentId));
          try {
            const nodes = await chromeP.bookmarksGet(String(currentId));
            const node = nodes && nodes[0];
            if (!node || !node.parentId) break;
            currentId = node.parentId;
          } catch (_) {
            break;
          }
        }
        return ids;
      }
      const ancestors = await getAncestorIds(nodeId);
      return ancestors.includes(String(rootFolderId));
    })(moveInfo.parentId, rootFolderId);
    if (!underRoot) return;
    const itemMap = { ...(state.itemMap || {}) };
    const collectionMap = { ...(state.collectionMap || {}) };
    const groupMap = { ...(state.groupMap || {}) };
    const itemByLocal = invertRecord(itemMap);
    const collectionByLocal = invertRecord(collectionMap);
    const unsortedFolderId =
      collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
    if (itemByLocal[String(id)]) {
      const raindropId = itemByLocal[String(id)];
      let newCollectionId = null;
      if (String(moveInfo.parentId) === String(unsortedFolderId))
        newCollectionId = UNSORTED_COLLECTION_ID;
      else {
        const mapped = collectionByLocal[String(moveInfo.parentId)];
        newCollectionId =
          mapped != null ? Number(mapped) : UNSORTED_COLLECTION_ID;
      }
      try {
        await apiPUT(`/raindrop/${encodeURIComponent(raindropId)}`, {
          collection: { $id: newCollectionId },
        });
      } catch (_) {}
      return;
    }
    if (collectionByLocal[String(id)]) {
      const collectionId = collectionByLocal[String(id)];
      let parentCollectionId = null;
      const isParentGroup = Object.values(groupMap).some(
        (gid) => String(gid) === String(moveInfo.parentId),
      );
      const isParentRoot = String(moveInfo.parentId) === String(rootFolderId);
      if (
        isParentGroup ||
        isParentRoot ||
        String(moveInfo.parentId) === String(unsortedFolderId)
      )
        parentCollectionId = null;
      else {
        const mapped = collectionByLocal[String(moveInfo.parentId)];
        parentCollectionId = mapped != null ? Number(mapped) : null;
      }
      const body =
        parentCollectionId == null
          ? { parent: null }
          : { parent: { $id: parentCollectionId } };
      try {
        await apiPUT(`/collection/${encodeURIComponent(collectionId)}`, body);
      } catch (_) {}
    }
  } catch (_) {}
});

// Alarms
chrome.runtime.onStartup?.addListener(() => {
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) performSync();
  else if (alarm && alarm.name === 'raindrop-clear-badge') clearBadge();
  else if (
    alarm &&
    alarm.name &&
    alarm.name.startsWith(WINDOW_SYNC_ALARM_PREFIX)
  ) {
    const winId = Number(alarm.name.substring(WINDOW_SYNC_ALARM_PREFIX.length));
    const sess = windowSyncSessions.get(Number(winId));
    if (!sess || sess.stopped) return;
    (async () => {
      try {
        await overrideCollectionWithWindowTabs(
          chrome,
          sess.collectionId,
          sess.windowId,
        );
      } catch (_) {}
    })();
  }
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});

// Windows/tabs listeners to drive window sync badge/title and scheduling
chrome.tabs?.onCreated.addListener((tab) => {
  try {
    const winId = tab && tab.windowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabs?.onRemoved.addListener((_tabId, removeInfo) => {
  try {
    const winId = removeInfo && removeInfo.windowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabs?.onUpdated.addListener((_tabId, changeInfo, tab) => {
  try {
    const winId = tab && tab.windowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    if (
      'url' in (changeInfo || {}) ||
      'title' in (changeInfo || {}) ||
      'pinned' in (changeInfo || {}) ||
      (changeInfo && changeInfo.status === 'complete')
    ) {
      scheduleWindowSync(chrome, Number(winId));
    }
  } catch (_) {}
  try {
    if (changeInfo && changeInfo.status === 'complete') {
      restoreActionUiForActiveWindow(chrome, chromeP);
    }
  } catch (_) {}
});
chrome.tabs?.onMoved.addListener((_tabId, moveInfo) => {
  try {
    const winId = moveInfo && moveInfo.windowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabs?.onAttached.addListener((_tabId, attachInfo) => {
  try {
    const winId = attachInfo && attachInfo.newWindowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabs?.onDetached.addListener((_tabId, detachInfo) => {
  try {
    const winId = detachInfo && detachInfo.oldWindowId;
    if (!windowSyncSessions.has(Number(winId))) return;
    scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.windows?.onFocusChanged?.addListener((_windowId) => {
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.windows?.onCreated?.addListener((_window) => {
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabs?.onActivated?.addListener((_activeInfo) => {
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabGroups?.onCreated?.addListener((_group) => {
  try {
    for (const winId of windowSyncSessions.keys())
      scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabGroups?.onUpdated?.addListener((_group) => {
  try {
    for (const winId of windowSyncSessions.keys())
      scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.tabGroups?.onRemoved?.addListener((_group) => {
  try {
    for (const winId of windowSyncSessions.keys())
      scheduleWindowSync(chrome, Number(winId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});
chrome.windows?.onRemoved.addListener((windowId) => {
  try {
    stopWindowSync(chrome, Number(windowId));
  } catch (_) {}
  try {
    restoreActionUiForActiveWindow(chrome, chromeP);
  } catch (_) {}
});

// Message router for popup commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message && message.type === 'performSync') {
        await performSync();
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'listSavedProjects') {
        const items = await listSavedProjects();
        sendResponse({ ok: true, items });
        return;
      }
      if (message && message.type === 'recoverSavedProject') {
        const id = message && message.id;
        const restoreResult = await recoverSavedProject(chrome, id);
        if (restoreResult && restoreResult.focusedExisting) {
          sendResponse({ ok: true });
          return;
        }
        try {
          const colId = Number(id);
          if (Number.isFinite(colId)) {
            const res = await apiGET(
              `/collection/${encodeURIComponent(colId)}`,
            );
            const item = (res && (res.item || res.data || res)) || {};
            const title = String(item.title || '');
            const shouldSync = /^\s*⏫?\s+/.test(title);
            if (shouldSync) {
              let winId = null;
              try {
                const normals = await new Promise((resolve) =>
                  chrome.windows.getAll({ windowTypes: ['normal'] }, (ws) =>
                    resolve(ws || []),
                  ),
                );
                if (Array.isArray(normals) && normals.length) {
                  const lastFocused =
                    normals.find((w) => w.focused) || normals[0];
                  winId = lastFocused && lastFocused.id;
                }
              } catch (_) {}
              if (Number.isFinite(Number(winId))) {
                await startSyncWindowToExistingProject(
                  chromeP,
                  colId,
                  title,
                  Number(winId),
                );
              }
            }
          }
        } catch (_) {}
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'deleteSavedProject') {
        const id = message && message.id;
        await deleteSavedProject(chromeP, id);
        sendResponse({ ok: true });
        return;
      }
      if (
        message &&
        message.type === 'saveCurrentOrHighlightedTabsToRaindrop'
      ) {
        await saveCurrentOrHighlightedTabsToRaindrop(chrome, chromeP);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'saveHighlightedTabsAsProject') {
        const projectName = (message && message.name) || '';
        await saveHighlightedTabsAsProject(chrome, projectName);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'startSyncCurrentWindowAsProject') {
        const projectName = (message && message.name) || '';
        let winId = null;
        try {
          const tabs = await new Promise((resolve) =>
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (ts) =>
              resolve(ts || []),
            ),
          );
          const t = Array.isArray(tabs) && tabs.length ? tabs[0] : null;
          if (t && t.windowId != null) winId = Number(t.windowId);
        } catch (_) {}
        if (!Number.isFinite(winId)) {
          const fromSender = sender && sender.tab && sender.tab.windowId;
          if (Number.isFinite(Number(fromSender))) winId = Number(fromSender);
        }
        if (!Number.isFinite(winId)) {
          try {
            const normals = await new Promise((resolve) =>
              chrome.windows.getAll({ windowTypes: ['normal'] }, (ws) =>
                resolve(ws || []),
              ),
            );
            if (Array.isArray(normals) && normals.length)
              winId = Number(normals[0].id);
          } catch (_) {}
        }
        if (!Number.isFinite(winId)) {
          sendResponse({ ok: false, error: 'NO_WINDOW_ID' });
          return;
        }
        await startSyncCurrentWindowAsProject(
          chrome,
          chromeP,
          projectName,
          Number(winId),
        );
        sendResponse({ ok: true });
        return;
      }
    } catch (_) {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes && changes.raindropApiToken) {
    const newToken = (changes.raindropApiToken.newValue || '').trim();
    const oldToken = (changes.raindropApiToken.oldValue || '').trim();
    setFacadeToken(newToken);
    if (newToken && newToken !== oldToken) {
      try {
        performSync();
      } catch (_) {}
    }
  }
});

chrome.notifications?.onClicked.addListener((notificationId) => {
  if (notificationId === TOKEN_NOTIFICATION_ID) {
    try {
      chrome.runtime.openOptionsPage();
    } catch (_) {}
    try {
      chrome.notifications.clear(notificationId);
    } catch (_) {}
  } else if (notificationId === SYNC_SUCCESS_NOTIFICATION_ID) {
    (async () => {
      try {
        const data = await chromeP.storageGet('rootFolderId');
        const rootId =
          data && data.rootFolderId ? String(data.rootFolderId) : '';
        const url = rootId
          ? `chrome://bookmarks/?id=${encodeURIComponent(rootId)}`
          : 'chrome://bookmarks';
        try {
          chrome.tabs?.create({ url });
        } catch (_) {
          try {
            chrome.tabs?.create({ url: 'chrome://bookmarks' });
          } catch (_) {}
        }
      } catch (_) {}
      try {
        chrome.notifications.clear(notificationId);
      } catch (_) {}
    })();
  }
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  const { menuItemId } = info;
  if (menuItemId === 'save-link') {
    const url = info.linkUrl;
    if (url) {
      // For links, the title is the link's text content, or the URL itself if no text is selected.
      const title = info.selectionText || info.linkUrl;
      await saveUrlToUnsorted(url, title);
    }
  } else if (menuItemId === 'save-page') {
    const url = info.pageUrl;
    if (url) {
      await saveUrlToUnsorted(url, tab?.title || info.pageUrl);
    }
  }
});
