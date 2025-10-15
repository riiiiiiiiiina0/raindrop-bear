// Raindrop Bear Background Service Worker (Manifest V3) – modular orchestration
import { apiPOST, setFacadeToken } from './modules/api-facade.js';
import {
  TOKEN_NOTIFICATION_ID,
  notifySyncFailure,
  notifySyncSuccess,
  SYNC_SUCCESS_NOTIFICATION_ID,
  notifyUnsortedSave,
  UNSORTED_SAVE_NOTIFICATION_ID,
  notify,
} from './modules/notifications.js';
import {
  UNSORTED_COLLECTION_ID,
  removeLegacyTopFolders,
} from './modules/bookmarks.js';
import { chromeP } from './modules/chrome.js';
import { setBadge, clearBadge, flashBadge } from './modules/ui.js';
import { loadState, saveState } from './modules/state.js';
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
  syncNewAndUpdatedItems,
  syncDeletedItems,
} from './modules/item-sync.js';
import { ensureRootAndMaybeReset } from './modules/root-ensure.js';
import {
  isSyncing,
  setIsSyncing,
  setSuppressLocalBookmarkEvents,
} from './modules/shared-state.js';
import {
  ACTIVE_SYNC_SESSIONS_KEY,
  WINDOW_SYNC_ALARM_PREFIX,
  windowSyncSessions,
  loadActiveSyncSessionsIntoMemory,
  scheduleWindowSync,
  stopWindowSync,
  restoreActionUiForActiveWindow,
  overrideCollectionWithWindowTabs,
} from './modules/window-sync.js';
import {
  listSavedProjects,
  recoverSavedProject,
  deleteSavedProject,
  saveCurrentOrHighlightedTabsToRaindrop,
  saveHighlightedTabsAsProject,
  saveWindowAsProject,
  replaceSavedProjectWithTabs,
  addTabsToProject,
  renameSavedProjectsGroup,
  archiveProject,
} from './modules/projects.js';
import './modules/oauth.js';

const ALARM_NAME = 'raindrop-sync';
const SYNC_PERIOD_MINUTES = 10;

// --- Tab Title Management (Global Variables) ---
let tabTitlesCache = {};

// --- Tab Title Management Functions ---

// Helper function to load titles from storage into the cache. Returns a promise.
/** @returns {Promise<void>} */
const loadTitlesToCache = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get('tabTitles', (data) => {
      tabTitlesCache = data.tabTitles || {};
      console.log('Tab titles loaded into cache.');
      resolve();
    });
  });
};

// Helper function to apply title with retry logic
const applyTitleWithRetry = (tabId, title, maxRetries = 3, delay = 1000) => {
  let attempts = 0;

  const attemptApply = () => {
    attempts++;
    chrome.tabs.sendMessage(
      tabId,
      { type: 'set_custom_title', title: title },
      (response) => {
        if (chrome.runtime.lastError) {
          const message = String(
            chrome.runtime.lastError.message || chrome.runtime.lastError,
          );
          const noReceiver =
            message.includes('Receiving end does not exist') ||
            message.includes('Could not establish connection') ||
            message.includes('The message port closed') ||
            message.includes('No matching recipient') ||
            message.includes('Disconnected port');

          if (noReceiver && attempts < maxRetries) {
            console.log(
              `Title application failed for tab ${tabId}, attempt ${attempts}/${maxRetries}. Retrying in ${delay}ms...`,
            );
            setTimeout(attemptApply, delay);
          } else if (attempts >= maxRetries) {
            console.warn(
              `Failed to apply title to tab ${tabId} after ${maxRetries} attempts. Will try again when tab updates.`,
            );
          }
        } else {
          console.log(`Successfully applied title "${title}" to tab ${tabId}`);
        }
      },
    );
  };

  attemptApply();
};

const processNewTitleResponse = (tab, response) => {
  if (!tab || typeof tab.id !== 'number') {
    console.warn('No valid tab id to apply title changes.');
    return;
  }
  if (response && response.newTitle !== null) {
    const newTitle = response.newTitle.trim();
    if (newTitle) {
      // Set the custom title in cache and storage
      tabTitlesCache[tab.id] = { title: newTitle, url: tab.url };
      chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'set_custom_title',
          title: newTitle,
        });
      });
    } else {
      // Remove the custom title from cache and storage
      delete tabTitlesCache[tab.id];
      chrome.storage.local.set({ tabTitles: tabTitlesCache }, () => {
        chrome.tabs.sendMessage(tab.id, { type: 'remove_custom_title' });
      });
    }
  }
};

const requestPromptForTab = (tab, hasReloaded = false) => {
  if (!tab || typeof tab.id !== 'number') {
    console.warn('No valid tab id to request prompt.');
    return;
  }
  chrome.tabs.sendMessage(
    tab.id,
    { type: 'get_new_title_prompt' },
    (response) => {
      if (chrome.runtime.lastError) {
        const message = String(
          chrome.runtime.lastError.message || chrome.runtime.lastError,
        );
        const noReceiver =
          message.includes('Receiving end does not exist') ||
          message.includes('Could not establish connection') ||
          message.includes('The message port closed') ||
          message.includes('No matching recipient') ||
          message.includes('Disconnected port');
        if (noReceiver && !hasReloaded) {
          console.warn(
            'Content script not injected. Reloading tab to inject content script.',
          );
          chrome.tabs.reload(tab.id, {}, () => {
            const onceListener = (updatedTabId, changeInfo, updatedTab) => {
              if (updatedTabId === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(onceListener);
                chrome.tabs.get(tab.id, (freshTab) => {
                  requestPromptForTab(freshTab, true);
                });
              }
            };
            chrome.tabs.onUpdated.addListener(onceListener);
          });
        } else {
          console.error(
            'Could not communicate with content script.',
            chrome.runtime.lastError,
          );
        }
        return;
      }
      processNewTitleResponse(tab, response);
    },
  );
};

// Periodic check to ensure all tabs with custom titles have them applied
// This serves as a fallback for any missed applications
const performPeriodicTitleCheck = async () => {
  if (Object.keys(tabTitlesCache).length === 0) {
    await loadTitlesToCache();
  }

  if (Object.keys(tabTitlesCache).length === 0) return;

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      const customTitleRecord = tabTitlesCache[tab.id];
      if (customTitleRecord && typeof tab.id === 'number') {
        // Check if the tab's current title matches our custom title
        // If not, it might need to be reapplied
        if (tab.title !== customTitleRecord.title) {
          console.log(
            `Periodic check: Reapplying title "${customTitleRecord.title}" to tab ${tab.id}`,
          );
          applyTitleWithRetry(tab.id, customTitleRecord.title, 1, 500);
        }
      }
    }
  });
};

// Export for use in projects.js
export function getTabTitlesCache() {
  return tabTitlesCache;
}

async function recursivelyFindBookmarks(folderId) {
  const bookmarks = [];
  try {
    const tree = await chromeP.bookmarksGetSubTree(folderId);
    function flatten(nodes) {
      for (const node of nodes) {
        if (node.url) {
          bookmarks.push(node);
        }
        if (node.children) {
          flatten(node.children);
        }
      }
    }
    if (tree && tree[0] && tree[0].children) {
      flatten(tree[0].children);
    }
  } catch (e) {
    console.error(`Failed to get bookmarks subtree for ${folderId}`, e);
  }
  return bookmarks;
}

async function deleteLocalData() {
  try {
    const { rootFolderId } = await loadState();
    if (rootFolderId) {
      try {
        await chromeP.bookmarksRemoveTree(rootFolderId);
      } catch (error) {
        // Ignore error if folder is already gone
        if (!String(error).includes('not found')) {
          console.error('Failed to remove root folder:', error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to get root folder for deletion:', error);
  }

  // Clear all sync-related data
  await saveState({
    lastSync: null,
    collectionMap: {},
    groupMap: {},
    itemMap: {},
    rootFolderId: null,
  });
}

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
    const {
      didReset,
      rootFolderId,
      state: updatedState,
    } = await ensureRootAndMaybeReset();
    state = updatedState;
    const { groups, rootCollections, childCollections } =
      await fetchGroupsAndCollections();
    const SAVED_PROJECTS_TITLE = '🐻‍❄️ Projects';
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
    let prunedItemMap = updatedItemMap;
    let deletionsChanged = false;
    if (state.lastSync) {
      const result = await syncDeletedItems(
        state.lastSync,
        updatedItemMap,
        collectionMap,
      );
      prunedItemMap = result.itemMap;
      deletionsChanged = result.didChange;
    } else {
      // Full sync: find and remove orphaned bookmarks
      const localBookmarks = await recursivelyFindBookmarks(rootFolderId);
      const validLocalIds = new Set(Object.values(updatedItemMap));
      for (const bookmark of localBookmarks) {
        if (!validLocalIds.has(bookmark.id)) {
          try {
            await chromeP.bookmarksRemove(bookmark.id);
            deletionsChanged = true;
          } catch (error) {
            console.warn(`Failed to remove orphaned bookmark: ${error}`);
          }
        }
      }
    }

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
  setBadge('⬆️', '#f59e0b');
  try {
    const existing = await apiPOST('/import/url/exists', { urls: [url] });

    if (
      existing &&
      existing.result === true &&
      existing.ids &&
      existing.ids.length > 0
    ) {
      notify('Link already exists.');
      flashBadge(true);
      return;
    }

    const body = {
      link: url,
      title: title || url,
      collection: { $id: UNSORTED_COLLECTION_ID },
      pleaseParse: {},
    };
    await apiPOST('/raindrop', body);
    notifyUnsortedSave('Link saved to Unsorted!');
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

  // Clean up window sync sessions
  try {
    await chromeP.storageSet({ [ACTIVE_SYNC_SESSIONS_KEY]: {} });
    const alarms = await new Promise((resolve) =>
      chrome.alarms.getAll((as) => resolve(as || [])),
    );
    (alarms || []).forEach((a) => {
      if (a && a.name && a.name.startsWith(WINDOW_SYNC_ALARM_PREFIX)) {
        try {
          chrome.alarms.clear(a.name);
        } catch (_) {}
      }
    });
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

  const isUpdate = details.reason === 'update';
  const [major, minor, patch] =
    details.previousVersion?.split('.').map(Number) || [];

  const shouldMigrateSavedProjects = isUpdate && major === 1 && minor <= 82;

  const shouldShowUpdateNote = isUpdate && major === 1 && minor < 53;

  if (shouldMigrateSavedProjects) {
    try {
      await renameSavedProjectsGroup();
    } catch (e) {
      console.error('Failed to rename saved projects group', e);
    }
  }

  // show update note on update
  if (shouldShowUpdateNote) {
    try {
      chrome.tabs.create({
        url: 'https://triiii.notion.site/Hello-from-Raindrop-Bear-2547aa7407c180d28e08f4f6dc41cdfd',
      });
    } catch (_) {}
  }
  // init after install
  else if (details.reason === 'install') {
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
      if (message && message.type === 'resetAndSync') {
        await deleteLocalData();
        await performSync();
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'clearAuth') {
        // Clear local data without performing sync (for logout/token clear)
        await deleteLocalData();
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'saveUrlToUnsorted') {
        const { url, title } = message;
        await saveUrlToUnsorted(url, title);
        sendResponse({ ok: true });
        return;
      }
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
        const { id, title } = message || {};
        const restoreResult = await recoverSavedProject(chrome, id, {
          forceNewWindow: false,
          title,
        });
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'recoverSavedProjectInNewWindow') {
        const { id, title } = message || {};
        await recoverSavedProject(chrome, id, {
          forceNewWindow: true,
          title,
        });
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'deleteSavedProject') {
        const id = message && message.id;
        await deleteSavedProject(chromeP, id);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'archiveProject') {
        const id = message && message.id;
        await archiveProject(id);
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
      if (message && message.type === 'saveWindowAsProject') {
        const projectName = (message && message.name) || '';
        await saveWindowAsProject(chrome, projectName);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'replaceSavedProject') {
        const { id, useHighlighted } = message;
        const tabs = await new Promise((resolve) =>
          chrome.tabs.query(
            useHighlighted
              ? {
                  windowId: chrome.windows.WINDOW_ID_CURRENT,
                  highlighted: true,
                }
              : { windowId: chrome.windows.WINDOW_ID_CURRENT },
            (ts) => resolve(ts || []),
          ),
        );
        await replaceSavedProjectWithTabs(chrome, id, tabs);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'addTabsToProject') {
        const { id } = message;
        const tabs = await new Promise((resolve) =>
          chrome.tabs.query(
            {
              windowId: chrome.windows.WINDOW_ID_CURRENT,
              highlighted: true,
            },
            (ts) => resolve(ts || []),
          ),
        );
        const activeTabs =
          tabs.length > 0
            ? tabs
            : await new Promise((resolve) =>
                chrome.tabs.query({ active: true, currentWindow: true }, (ts) =>
                  resolve(ts || []),
                ),
              );
        await addTabsToProject(chrome, id, activeTabs);
        sendResponse({ ok: true });
        return;
      }
      if (message && message.type === 'rename-tab') {
        const tabs = await new Promise((resolve) =>
          chrome.tabs.query({ active: true, currentWindow: true }, (ts) =>
            resolve(ts || []),
          ),
        );
        const activeTab = tabs && tabs[0];
        if (activeTab && typeof activeTab.id === 'number') {
          requestPromptForTab(activeTab);
        }
        sendResponse({ ok: true });
        return;
      }
      // Handle check_custom_title from content scripts
      if (
        message &&
        message.type === 'check_custom_title' &&
        sender.tab &&
        typeof sender.tab.id === 'number'
      ) {
        const customTitleRecord = tabTitlesCache[sender.tab.id];
        if (customTitleRecord) {
          sendResponse({
            hasCustomTitle: true,
            title: customTitleRecord.title,
          });
        } else {
          sendResponse({ hasCustomTitle: false });
        }
        return;
      }
      // Handle apply_custom_title from projects.js when recovering projects
      if (message && message.type === 'apply_custom_title') {
        const { tabId, title, url } = message;
        if (typeof tabId === 'number' && title) {
          // Reload cache from storage to get the latest data
          await loadTitlesToCache();
          const cacheHasTitle = tabTitlesCache[tabId] !== undefined;
          console.log(
            `apply_custom_title: tab ${tabId}, title "${title}", cache has it: ${cacheHasTitle}, cache size: ${
              Object.keys(tabTitlesCache).length
            }`,
          );
          // Apply with retry logic
          applyTitleWithRetry(tabId, title, 5, 500);
        }
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
  } else if (String(notificationId).startsWith('project-archived-')) {
    const collectionId = String(notificationId).substring(
      'project-archived-'.length,
    );
    if (collectionId) {
      try {
        chrome.tabs?.create({
          url: `https://app.raindrop.io/my/${collectionId}`,
        });
      } catch (_) {}
    }
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
  } else if (notificationId === UNSORTED_SAVE_NOTIFICATION_ID) {
    try {
      chrome.tabs?.create({
        url: 'https://app.raindrop.io/my/-1',
      });
    } catch (_) {}
    try {
      chrome.notifications.clear(notificationId);
    } catch (_) {}
  } else if (String(notificationId).startsWith('project-saved-')) {
    const collectionId = String(notificationId).substring(
      'project-saved-'.length,
    );
    if (collectionId) {
      try {
        chrome.tabs?.create({
          url: `https://app.raindrop.io/my/${collectionId}`,
        });
      } catch (_) {}
    }
    try {
      chrome.notifications.clear(notificationId);
    } catch (_) {}
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-to-unsorted') {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      await saveUrlToUnsorted(tab.url, tab.title);
    }
  } else if (command === 'rename-tab') {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && typeof tab.id === 'number') {
      requestPromptForTab(tab);
    }
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

// --- Tab Title Management Initialization ---

// Load cache when the extension is installed or updated
chrome.runtime.onInstalled.addListener(loadTitlesToCache);

// Also load cache when service worker starts (handles service worker restarts)
// This ensures we have the cache available even if the service worker was terminated
(async () => {
  await loadTitlesToCache();
  console.log('Service worker initialized, tab titles cache loaded.');
})();

// Run periodic check every 30 seconds
setInterval(performPeriodicTitleCheck, 30000);

// Load cache and re-map titles on browser startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Browser starting up. Restoring custom tab titles.');
  await loadTitlesToCache();

  const oldTabTitles = { ...tabTitlesCache };
  if (Object.keys(oldTabTitles).length === 0) return;

  const urlToRecord = {};
  for (const tabId in oldTabTitles) {
    const record = oldTabTitles[tabId];
    urlToRecord[record.url] = record; // Last one wins for duplicate URLs
  }

  chrome.tabs.query({}, (tabs) => {
    const newTabTitles = {};
    const tabsToProcess = [];

    for (const tab of tabs) {
      const record = urlToRecord[tab.url];
      if (record && typeof tab.id === 'number') {
        // Match found: create a new record with the new tab ID
        newTabTitles[tab.id] = { title: record.title, url: tab.url };
        tabsToProcess.push({ tabId: tab.id, title: record.title });
        delete urlToRecord[tab.url]; // Prevent re-use for other tabs with same URL
      }
    }

    // Replace the old cache and storage with the new, correct mappings
    tabTitlesCache = newTabTitles;
    chrome.storage.local.set({ tabTitles: tabTitlesCache });

    // Apply titles with staggered timing to avoid overwhelming the system
    tabsToProcess.forEach((item, index) => {
      setTimeout(() => {
        applyTitleWithRetry(item.tabId, item.title);
      }, index * 200); // Stagger by 200ms each
    });

    console.log(`Finished re-mapping ${tabsToProcess.length} tab titles.`);
  });
});

// --- Tab Lifecycle Listeners for Custom Titles ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // If cache is empty, it might be due to service worker restart. Load it.
  if (Object.keys(tabTitlesCache).length === 0) {
    await loadTitlesToCache();
  }
  const customTitleRecord = tabTitlesCache[tabId];
  if (!customTitleRecord) {
    // Check if this tab should have a title but cache doesn't have it yet
    if (changeInfo.status === 'complete') {
      // Reload cache and check again as a safety measure
      await loadTitlesToCache();
      const reloadedRecord = tabTitlesCache[tabId];
      if (!reloadedRecord) {
        return; // This tab doesn't have a custom title
      }
      // Continue with the reloaded record
      const applyTitle = () => {
        console.log(
          `onUpdated (after cache reload): applying title "${reloadedRecord.title}" to tab ${tabId}`,
        );
        applyTitleWithRetry(tabId, reloadedRecord.title, 5, 500);
      };
      applyTitle();
      return;
    }
    return; // This tab doesn't have a custom title
  }

  // Helper function to apply the title with retry logic
  const applyTitle = () => {
    console.log(
      `onUpdated trigger: applying title "${customTitleRecord.title}" to tab ${tabId} (status: ${changeInfo.status})`,
    );
    applyTitleWithRetry(tabId, customTitleRecord.title, 5, 500); // Increased retries
  };

  // --- Trigger title application at multiple points for robustness ---

  // 1. When a discarded tab is reloaded, this is the first event fired.
  if (changeInfo.discarded === false) {
    applyTitle();
  }

  // 2. When the tab starts loading - apply immediately and repeatedly
  if (changeInfo.status === 'loading') {
    applyTitle();
    // Apply again after a short delay to catch content script injection
    setTimeout(() => applyTitle(), 100);
    setTimeout(() => applyTitle(), 300);
  }

  // 3. When the tab has finished loading
  if (changeInfo.status === 'complete') {
    applyTitle();
  }

  // 4. When the page's title changes to something else
  if (changeInfo.title && changeInfo.title !== customTitleRecord.title) {
    applyTitle();
  }

  // --- Handle URL changes for persistence ---
  if (changeInfo.url) {
    tabTitlesCache[tabId].url = changeInfo.url;
    chrome.storage.local.set({ tabTitles: tabTitlesCache });
  }
});

// Fired when a tab is replaced with another tab due to prerendering or instant.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (tabTitlesCache[removedTabId]) {
    console.log(
      `Tab ${removedTabId} was replaced by ${addedTabId}. Transferring title.`,
    );
    const record = tabTitlesCache[removedTabId];
    tabTitlesCache[addedTabId] = record;
    delete tabTitlesCache[removedTabId];

    chrome.storage.local.set({ tabTitles: tabTitlesCache });

    // Apply the title to the new tab with retry logic.
    applyTitleWithRetry(addedTabId, record.title);
  }
});

// Apply custom title when a tab becomes active (user switches to it)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // If cache is empty, it might be due to service worker restart. Load it.
  if (Object.keys(tabTitlesCache).length === 0) {
    await loadTitlesToCache();
  }

  const customTitleRecord = tabTitlesCache[activeInfo.tabId];
  if (customTitleRecord) {
    // Apply the title when the tab becomes active
    applyTitleWithRetry(activeInfo.tabId, customTitleRecord.title, 2, 300);
  }
});

// Clean up storage and cache when a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabTitlesCache[tabId]) {
    delete tabTitlesCache[tabId];
    chrome.storage.local.set({ tabTitles: tabTitlesCache });
  }
});
