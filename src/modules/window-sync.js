import {
  setActionTitle,
  setBadge,
  scheduleClearBadge,
  clearBadge,
  notify,
} from './ui.js';
import {
  apiGET,
  apiPOST,
  apiPUT,
  apiDELETE,
  apiGETText,
} from './api-facade.js';

export const ACTIVE_SYNC_SESSIONS_KEY = 'activeWindowSyncSessions';
export const WINDOW_SYNC_ALARM_PREFIX = 'raindrop-window-sync-';

/** @type {Map<number, { collectionId: number, windowId: number, name: string, stopped?: boolean }>} */
export const windowSyncSessions = new Map();

export function projectNameWithoutPrefix(name) {
  const s = String(name || '');
  return s.trim();
}

export async function persistActiveSyncSessions(chromeP) {
  const obj = {};
  for (const [winId, sess] of windowSyncSessions.entries()) {
    obj[String(winId)] = { collectionId: sess.collectionId, name: sess.name };
  }
  try {
    await chromeP.storageSet({ [ACTIVE_SYNC_SESSIONS_KEY]: obj });
  } catch (_) {}
}

export async function loadActiveSyncSessionsIntoMemory(chromeP) {
  try {
    const data = await chromeP.storageGet(ACTIVE_SYNC_SESSIONS_KEY);
    const saved = data && data[ACTIVE_SYNC_SESSIONS_KEY];
    const obj = saved && typeof saved === 'object' ? saved : {};
    windowSyncSessions.clear();
    for (const [k, v] of Object.entries(obj)) {
      const winId = Number(k);
      const collectionId = Number(v && v.collectionId);
      const name = String(v && v.name) || '';
      if (!Number.isFinite(winId) || !Number.isFinite(collectionId)) continue;
      windowSyncSessions.set(winId, { collectionId, windowId: winId, name });
    }
  } catch (_) {}
}

export function scheduleWindowSync(chrome, windowId, timeoutMs = 1500) {
  const sess = windowSyncSessions.get(Number(windowId));
  if (!sess || sess.stopped) return;
  const name = `${WINDOW_SYNC_ALARM_PREFIX}${Number(windowId)}`;
  try {
    chrome.alarms.clear(name, () => {
      try {
        chrome.alarms.create(name, {
          when: Date.now() + Math.max(300, Number(timeoutMs) || 1500),
        });
      } catch (_) {}
    });
  } catch (_) {}
}

export function stopWindowSync(chrome, windowId) {
  const sess = windowSyncSessions.get(Number(windowId));
  if (!sess) return;
  sess.stopped = true;
  try {
    chrome.alarms.clear(`${WINDOW_SYNC_ALARM_PREFIX}${Number(windowId)}`);
  } catch (_) {}
  windowSyncSessions.delete(Number(windowId));
}

export async function restoreActionUiForActiveWindow(chrome, chromeP) {
  try {
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
      try {
        const w = await new Promise((resolve) =>
          chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (ww) =>
            resolve(ww || null),
          ),
        );
        if (w && w.id != null) winId = Number(w.id);
      } catch (_) {}
    }
    let currentBadge = '';
    try {
      currentBadge = await new Promise((resolve) =>
        chrome.action?.getBadgeText({}, (text) => resolve(text || '')),
      );
    } catch (_) {}
    setActionTitle('Raindrop Bear');
    if (currentBadge === '⏫') {
      setBadge('');
    }
  } catch (_) {}
}

export async function startSyncWindowToExistingProject(
  chromeP,
  collectionId,
  projectName,
  windowId,
) {
  const colId = Number(collectionId);
  const winId = Number(windowId);
  if (!Number.isFinite(colId) || !Number.isFinite(winId)) return;
  const name = String(projectName || '');
  try {
    windowSyncSessions.set(winId, {
      collectionId: colId,
      windowId: winId,
      name,
    });
    await persistActiveSyncSessions(chromeP);
  } catch (_) {}
}

export async function createCollectionUnderSavedProjects(title) {
  const userRes = await apiGET('/user');
  const groups = Array.isArray(userRes?.user?.groups)
    ? userRes.user.groups
    : [];
  const savedTitle = '🐻‍❄️ Projects';
  let groupsArray = groups.slice();
  let idx = groupsArray.findIndex((g) => (g && g.title) === savedTitle);
  if (idx === -1) {
    groupsArray = groupsArray.concat({
      title: savedTitle,
      hidden: false,
      sort: groupsArray.length,
      collections: [],
    });
    try {
      await apiPUT('/user', { groups: groupsArray });
    } catch (_) {}
    try {
      const uu = await apiGET('/user');
      groupsArray = Array.isArray(uu?.user?.groups)
        ? uu.user.groups
        : groupsArray;
    } catch (_) {}
    idx = groupsArray.findIndex((g) => (g && g.title) === savedTitle);
  }
  const created = await apiPOST('/collection', { title });
  const createdItem = created && (created.item || created.data || created);
  const collectionId = createdItem && (createdItem._id ?? createdItem.id);
  if (collectionId == null) throw new Error('Failed to create collection');
  try {
    const newGroups = groupsArray.slice();
    const entry = {
      ...(newGroups[idx] || { title: savedTitle, collections: [] }),
    };
    const cols = Array.isArray(entry.collections)
      ? entry.collections.slice()
      : [];
    const filtered = cols.filter((cid) => Number(cid) !== Number(collectionId));
    entry.collections = [Number(collectionId), ...filtered];
    newGroups[idx] = entry;
    await apiPUT('/user', { groups: newGroups });
  } catch (_) {}
  return Number(collectionId);
}

export async function buildItemsFromWindowTabs(chrome, windowId) {
  const tabsList = await new Promise((resolve) =>
    chrome.tabs.query({ windowId: Number(windowId) }, (ts) =>
      resolve(ts || []),
    ),
  );

  // Load custom tab titles from storage
  const tabTitlesData = await new Promise((resolve) =>
    chrome.storage.local.get('tabTitles', (data) =>
      resolve(data.tabTitles || {}),
    ),
  );

  const groupsInWindow = await new Promise((resolve) =>
    chrome.tabGroups?.query({ windowId: Number(windowId) }, (gs) =>
      resolve(gs || []),
    ),
  );
  const groupMap = new Map();
  (groupsInWindow || []).forEach((g) => groupMap.set(g.id, g));
  const eligible = (tabsList || []).filter(
    (t) =>
      t.url && (t.url.startsWith('https://') || t.url.startsWith('http://')),
  );
  return eligible.map((t, i) => {
    const baseTitle = t.title || t.url || '';
    const group = groupMap.get(t.groupId) || null;
    const meta = {
      index: i,
      pinned: t.pinned,
      tabGroup: group && group.title,
      tabGroupColor: group && group.color,
    };

    // Include custom title if it exists
    const customTitleRecord = tabTitlesData[t.id];
    if (customTitleRecord && customTitleRecord.title) {
      meta.customTitle = customTitleRecord.title;
    }

    return { link: t.url, title: baseTitle, note: JSON.stringify(meta) };
  });
}

export async function overrideCollectionWithWindowTabs(
  chrome,
  collectionId,
  windowId,
) {
  try {
    await apiGET(`/collection/${encodeURIComponent(Number(collectionId))}`);
  } catch (e) {
    stopWindowSync(chrome, windowId);
    throw e;
  }
  const itemsToSave = await buildItemsFromWindowTabs(chrome, windowId);
  if (itemsToSave.length === 0) return;
  try {
    await apiDELETE(`/raindrops/${encodeURIComponent(Number(collectionId))}`);
  } catch (_) {}
  try {
    await apiPOST('/raindrops', {
      items: itemsToSave.map((it) => ({
        link: it.link,
        title: it.title,
        note: it.note,
        collection: { $id: Number(collectionId) },
        pleaseParse: {},
      })),
    });
  } catch (_) {
    for (const it of itemsToSave) {
      try {
        await apiPOST('/raindrop', {
          link: it.link,
          title: it.title,
          note: it.note,
          collection: { $id: Number(collectionId) },
          pleaseParse: {},
        });
      } catch (_) {}
    }
  }
}
