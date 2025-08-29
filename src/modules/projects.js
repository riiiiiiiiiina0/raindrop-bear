import {
  apiGET,
  apiPOST,
  apiPUT,
  apiDELETE,
  apiGETText,
} from './api-facade.js';
import { setBadge, scheduleClearBadge, notify } from './ui.js';
import { loadState, saveState } from './state.js';
import { ensureUnsortedFolder } from './item-sync.js';
import {
  getOrCreateRootFolder,
  getOrCreateChildFolder,
} from './folder-sync.js';
import { rememberRecentlyCreatedRemoteUrls } from './shared-state.js';
import {
  windowSyncSessions,
  persistActiveSyncSessions,
} from './window-sync.js';
import { chromeP } from './chrome.js';
import { notifyUnsortedSave } from './notifications.js';

export async function renameSavedProjectsGroup() {
  try {
    const userRes = await apiGET('/user');
    const groups =
      userRes && userRes.user && Array.isArray(userRes.user.groups)
        ? userRes.user.groups
        : [];
    const oldName = 'Saved Projects';
    const newName = '🐻‍❄️ Projects';
    const idx = groups.findIndex((g) => g && g.title === oldName);
    if (idx === -1) {
      return; // No group with the old name found
    }
    const newGroups = groups.slice();
    newGroups[idx].title = newName;
    await apiPUT('/user', { groups: newGroups });
  } catch (error) {
    console.error('Failed to rename "Saved Projects" group:', error);
  }
}

export async function archiveProject(collectionId) {
  const colId = Number(collectionId);
  if (!Number.isFinite(colId)) return;

  setBadge('📥', '#3b82f6');

  try {
    const userRes = await apiGET('/user');
    const groups =
      userRes && userRes.user && Array.isArray(userRes.user.groups)
        ? userRes.user.groups
        : [];

    const projectsGroupTitle = '🐻‍❄️ Projects';
    const archivedGroupTitle = '🐻‍❄️ Archived Projects';

    let newGroups = JSON.parse(JSON.stringify(groups));

    let projectsGroup = newGroups.find((g) => g.title === projectsGroupTitle);
    if (projectsGroup) {
      projectsGroup.collections = (projectsGroup.collections || []).filter(
        (id) => Number(id) !== colId,
      );
    }

    let archivedGroup = newGroups.find((g) => g.title === archivedGroupTitle);
    if (!archivedGroup) {
      newGroups.push({
        title: archivedGroupTitle,
        hidden: false,
        sort: newGroups.length,
        collections: [colId],
      });
    } else {
      if (!archivedGroup.collections.includes(colId)) {
        archivedGroup.collections.unshift(colId);
      }
    }

    await apiPUT('/user', { groups: newGroups });

    setBadge('✔️', '#22c55e');
    scheduleClearBadge(3000);
    try {
      const collection = await apiGET(
        `/collection/${encodeURIComponent(colId)}`,
      );
      const title = collection?.item?.title || 'Project';
      const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
      chrome.notifications?.create(
        `project-archived-${colId}`,
        {
          type: 'basic',
          iconUrl,
          title: 'Raindrop Bear',
          message: `Project "${title}" archived.`,
          priority: 0,
        },
        () => {},
      );
    } catch (_) {
      notify(`Project archived successfully.`);
    }
  } catch (e) {
    setBadge('😵', '#ef4444');
    scheduleClearBadge(3000);
    notify(`Failed to archive project: ${e}`);
  }
}

export async function listSavedProjects() {
  const [userRes, rootsRes] = await Promise.all([
    apiGET('/user'),
    apiGET('/collections'),
  ]);
  const groups =
    userRes && userRes.user && Array.isArray(userRes.user.groups)
      ? userRes.user.groups
      : [];
  const saved = groups.find((g) => (g && g.title) === '🐻‍❄️ Projects');
  const order =
    saved && Array.isArray(saved.collections) ? saved.collections : [];
  const rootCollections = Array.isArray(rootsRes?.items) ? rootsRes.items : [];
  const byId = new Map();
  for (const c of rootCollections) {
    if (c && c._id != null) byId.set(c._id, c);
  }
  const result = [];
  for (const id of order) {
    const c = byId.get(id);
    if (!c) continue;
    result.push({
      id: c._id,
      title: c.title || '',
      count: c.count,
      lastUpdate: c.lastUpdate,
      cover: Array.isArray(c.cover) ? c.cover[0] || '' : c.cover || '',
    });
  }
  return result;
}

export async function recoverSavedProject(chrome, collectionId, options) {
  const colId = Number(collectionId);
  if (!Number.isFinite(colId)) return;
  const { forceNewWindow } = options || {};

  // If already syncing with a window, focus that window
  if (!forceNewWindow) {
    try {
      let existingWinId = null;
      for (const sess of windowSyncSessions.values()) {
        if (sess && !sess.stopped && Number(sess.collectionId) === colId) {
          existingWinId = sess.windowId;
          break;
        }
      }
      if (Number.isFinite(Number(existingWinId))) {
        let existingWindow = null;
        try {
          existingWindow = await new Promise((resolve) =>
            chrome.windows.get(Number(existingWinId), (w) => resolve(w)),
          );
        } catch (_) {}
        if (existingWindow) {
          try {
            await chrome.windows.update(Number(existingWinId), {
              focused: true,
            });
          } catch (_) {}
          return { focusedExisting: true, windowId: Number(existingWinId) };
        } else {
          try {
            windowSyncSessions.delete(Number(existingWinId));
            await persistActiveSyncSessions(chromeP);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
  const html = await apiGETText(`/raindrops/${colId}/export.html`);
  try {
    const items = [];
    const linkRegex = /<DT>\s*<A\s+[^>]*HREF="([^"]+)"[^>]*>([\s\S]*?)<\/A>/gi;
    const ddRegex = /<DD>\s*([\s\S]*?)(?=(?:<DT>|<\/DL>|$))/i;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1] ? match[1].trim() : '';
      const rawTitle = match[2] || '';
      const title = rawTitle
        .replace(/\s+/g, ' ')
        .replace(/<[^>]*>/g, '')
        .trim();
      const tail = html.slice(linkRegex.lastIndex);
      const ddMatch = ddRegex.exec(tail);
      let meta;
      if (ddMatch && ddMatch[1]) {
        const ddText = ddMatch[1]
          .replace(/\n|\r/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const normalized = ddText
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        try {
          meta = JSON.parse(normalized);
        } catch (_) {
          meta = undefined;
        }
      }
      items.push({ url, title, meta });
    }
    if (items.length === 0) throw new Error('No items found in export.html');
    const sorted = items.sort(
      (a, b) => (a.meta?.index ?? 0) - (b.meta?.index ?? 0),
    );
    const hasTabGroups = sorted.some((it) => it.meta?.tabGroup);
    if (!hasTabGroups && sorted.length > 0) {
      const projectTitle = options?.title;
      if (projectTitle) {
        for (const item of sorted) {
          if (!item.meta) {
            item.meta = {};
          }
          item.meta.tabGroup = projectTitle;
        }
      }
    }
    const first = sorted[0];
    // Determine whether to reuse current window (if it has one empty non-pinned tab)
    const isEmptyNewTabUrl = (u) => {
      const url = String(u || '').toLowerCase();
      if (!url) return true;
      return (
        url === 'about:blank' ||
        url.startsWith('chrome://newtab') ||
        url.startsWith('chrome://new-tab-page')
      );
    };
    let targetWindowId = null;
    let activeTab = null;
    let tabsToCreate = sorted.slice(1);
    if (forceNewWindow) {
      const newWindow = await chrome.windows.create({
        focused: true,
        url: first.url,
      });
      if (!newWindow) throw new Error('Failed to create new window');
      const [active] = await chrome.tabs.query({
        windowId: newWindow.id,
        active: true,
      });
      activeTab = active || null;
      if (activeTab && activeTab.id && (first.meta?.pinned ?? false)) {
        try {
          await chrome.tabs.update(activeTab.id, { pinned: true });
        } catch (_) {}
      }
      targetWindowId = newWindow.id;
    } else {
      const currentWindow = await new Promise((resolve) => {
        chrome.windows.get(
          chrome.windows.WINDOW_ID_CURRENT,
          { populate: true },
          (w) => resolve(w),
        );
      });
      targetWindowId = currentWindow.id;
      const soleTab =
        currentWindow.tabs.length === 1 ? currentWindow.tabs[0] : null;
      if (soleTab && !soleTab.pinned && isEmptyNewTabUrl(soleTab.url)) {
        // If the window is a single new tab, replace it
        await chrome.tabs.update(soleTab.id, {
          url: first.url,
          pinned: first.meta?.pinned ?? false,
          active: true,
        });
        activeTab = soleTab;
      } else {
        // Otherwise, add all tabs to the current window
        tabsToCreate = sorted;
      }
    }
    const tabGroups = [];
    if (activeTab && activeTab.id && first.meta?.tabGroup) {
      tabGroups.push({
        meta: {
          tabGroup: first.meta?.tabGroup,
          tabGroupColor: first.meta?.tabGroupColor,
        },
        tabIds: [activeTab.id],
      });
    }
    for (const it of tabsToCreate) {
      const newTab = await chrome.tabs.create({
        url: it.url,
        windowId: targetWindowId,
        pinned: it.meta?.pinned ?? false,
      });
      if (newTab && newTab.id && it.meta?.tabGroup !== null) {
        let group = tabGroups.find(
          (g) => g.meta.tabGroup === it.meta?.tabGroup,
        );
        if (!group) {
          group = {
            meta: {
              tabGroup: it.meta?.tabGroup,
              tabGroupColor: it.meta?.tabGroupColor,
            },
            tabIds: [],
          };
          tabGroups.push(group);
        }
        group.tabIds.push(newTab.id);
      }
    }
    for (const group of tabGroups) {
      if (group.tabIds.length > 0) {
        const tg = await chrome.tabs.group({ tabIds: group.tabIds });
        if (tg) {
          chrome.tabGroups.update(tg, {
            title: group.meta.tabGroup,
            color: group.meta.tabGroupColor,
          });
        }
      }
    }
  } catch (e) {
    console.error('Failed to parse export.html', e);
  }
}

export async function deleteSavedProject(chromeP, collectionId) {
  const colId = Number(collectionId);
  if (!Number.isFinite(colId)) return;
  setBadge('🗑️', '#ef4444');
  try {
    const [userRes, rootsRes] = await Promise.all([
      apiGET('/user'),
      apiGET('/collections'),
    ]);
    const groups = Array.isArray(userRes?.user?.groups)
      ? userRes.user.groups
      : [];
    const idx = groups.findIndex((g) => (g && g.title) === '🐻‍❄️ Projects');
    if (idx >= 0) {
      const newGroups = groups.slice();
      const entry = {
        ...(newGroups[idx] || { title: '🐻‍❄️ Projects', collections: [] }),
      };
      const cols = Array.isArray(entry.collections)
        ? entry.collections.slice()
        : [];
      entry.collections = cols.filter((cid) => Number(cid) !== colId);
      try {
        await apiPUT('/user', { groups: newGroups });
      } catch (_) {}
    }
    const roots = Array.isArray(rootsRes?.items) ? rootsRes.items : [];
    const existing = roots.find((c) => Number(c?._id) === colId);
    const title = existing?.title || 'Project';
    try {
      await apiDELETE(`/collection/${encodeURIComponent(colId)}`);
    } catch (_) {}
    setBadge('✔️', '#22c55e');
    scheduleClearBadge(3000);
    try {
      notify(`Deleted project "${title}"`);
    } catch (_) {}
  } catch (e) {
    setBadge('😵', '#ef4444');
    scheduleClearBadge(3000);
    try {
      notify(`Failed to delete project: ${e}`);
    } catch (_) {}
  }
}

export async function saveCurrentOrHighlightedTabsToRaindrop(chrome, chromeP) {
  setBadge('⬆️', '#f59e0b');
  let titlesAndUrls = [];
  try {
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query(
        { windowId: chrome.windows.WINDOW_ID_CURRENT, highlighted: true },
        (ts) => resolve(ts || []),
      ),
    );
    let candidates =
      Array.isArray(tabs) && tabs.length > 0
        ? tabs
        : await new Promise((resolve) =>
            chrome.tabs.query({ active: true, currentWindow: true }, (ts) =>
              resolve(ts || []),
            ),
          );
    for (const t of candidates) {
      const url = (t && t.url) || '';
      if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
        titlesAndUrls.push({ title: (t && t.title) || url, url });
      }
    }
    if (titlesAndUrls.length === 0)
      throw new Error('No eligible tabs to save.');

    // Check for existing URLs first
    const existing = await apiPOST('/import/url/exists', {
      urls: titlesAndUrls.map(({ url }) => url),
    });

    // Filter out existing URLs
    const existingUrls = new Set();
    if (existing && existing.result === true && existing.ids) {
      for (let i = 0; i < existing.ids.length; i++) {
        if (existing.ids[i]) {
          existingUrls.add(titlesAndUrls[i].url);
        }
      }
    }

    // Filter to only non-existing URLs
    titlesAndUrls = titlesAndUrls.filter(({ url }) => !existingUrls.has(url));

    if (titlesAndUrls.length === 0) {
      setBadge('ℹ️', '#3b82f6');
      scheduleClearBadge(3000);
      notify('All selected links already exist in Raindrop.');
      return;
    }

    const state = await loadState();
    const collectionMap = { ...(state.collectionMap || {}) };
    const unsortedFolderId = await ensureUnsortedFolder(
      getOrCreateRootFolder,
      getOrCreateChildFolder,
      collectionMap,
    );
    const body = {
      items: titlesAndUrls.map(({ title, url }) => ({
        link: url,
        title: title || url,
        collection: { $id: -1 },
        pleaseParse: {},
      })),
    };
    const res = await apiPOST('/raindrops', body);
    const createdItems = res && Array.isArray(res.items) ? res.items : [];
    const successCount = createdItems.length;
    const linkToId = new Map();
    for (const it of createdItems) {
      const link = it && (it.link || it.url);
      const id =
        it &&
        (it._id != null ? String(it._id) : it.id != null ? String(it.id) : '');
      if (link && id) linkToId.set(link, id);
    }
    const toCreateLocally = titlesAndUrls.map(({ title, url }) => ({
      id: linkToId.get(url) || '',
      title: title || url,
      url,
    }));
    rememberRecentlyCreatedRemoteUrls(toCreateLocally.map(({ url }) => url));
    const mergedItemMap = { ...((state && state.itemMap) || {}) };
    for (const { id, title, url } of toCreateLocally.slice().reverse()) {
      try {
        const node = await chrome.bookmarks.create({
          parentId: unsortedFolderId,
          title: title || url,
          url,
          index: 0,
        });
        if (id) mergedItemMap[id] = node.id;
      } catch (_) {}
    }
    try {
      await saveState({ itemMap: mergedItemMap });
    } catch (_) {}
    if (successCount > 0) {
      setBadge('✔️', '#22c55e');
      scheduleClearBadge(3000);
      try {
        notifyUnsortedSave(
          `Saved ${successCount} page${
            successCount > 1 ? 's' : ''
          } to Raindrop`,
        );
      } catch (_) {}
    } else {
      setBadge('😵', '#ef4444');
      scheduleClearBadge(3000);
      try {
        notify('Failed to save tab(s) to Raindrop');
      } catch (_) {}
    }
  } catch (err) {
    setBadge('😵', '#ef4444');
    scheduleClearBadge(3000);
    try {
      notify('Failed to save tab(s) to Raindrop');
    } catch (_) {}
  }
}

export async function saveHighlightedTabsAsProject(chrome, name) {
  const projectName = String(name || '').trim();
  if (!projectName) return;
  let tabsList = await new Promise((resolve) =>
    chrome.tabs.query(
      { windowId: chrome.windows.WINDOW_ID_CURRENT, highlighted: true },
      (ts) => resolve(ts || []),
    ),
  );
  await saveTabsListAsProject(chrome, projectName, tabsList || []);
}

export async function saveWindowAsProject(chrome, name) {
  const projectName = String(name || '').trim();
  if (!projectName) return;
  const tabsList = await new Promise((resolve) =>
    chrome.tabs.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }, (ts) =>
      resolve(ts || []),
    ),
  );
  await saveTabsListAsProject(chrome, projectName, tabsList || []);
}

export async function saveTabsListAsProject(chrome, name, tabsList) {
  setBadge('💾', '#a855f7');
  try {
    const eligibleTabs = (tabsList || []).filter(
      (t) =>
        t.url && (t.url.startsWith('https://') || t.url.startsWith('http://')),
    );
    if (!eligibleTabs.length) throw new Error('No eligible tabs');
    const groupsInWindow = await new Promise((resolve) =>
      chrome.tabGroups?.query(
        { windowId: chrome.windows.WINDOW_ID_CURRENT },
        (gs) => resolve(gs || []),
      ),
    );
    const groupIdToMeta = new Map();
    (groupsInWindow || []).slice().forEach((g) => {
      groupIdToMeta.set(g.id, g);
    });
    const items = eligibleTabs.map((t, i) => {
      const baseTitle = t.title || t.url || '';
      const group = groupIdToMeta.get(t.groupId) || null;
      const meta = {
        index: i,
        pinned: t.pinned,
        tabGroup: group && group.title,
        tabGroupColor: group && group.color,
      };
      return { link: t.url, title: baseTitle, note: JSON.stringify(meta) };
    });
    const userRes = await apiGET('/user');
    const groups =
      userRes && userRes.user && Array.isArray(userRes.user.groups)
        ? userRes.user.groups
        : [];
    const savedProjectsTitle = '🐻‍❄️ Projects';
    let groupsArray = groups.slice();
    let groupIndex = groupsArray.findIndex(
      (g) => (g.title || '') === savedProjectsTitle,
    );
    if (groupIndex === -1) {
      groupsArray = groupsArray.concat({
        title: savedProjectsTitle,
        hidden: false,
        sort: groupsArray.length,
        collections: [],
      });
      try {
        await apiPUT('/user', { groups: groupsArray });
      } catch (_) {}
      try {
        const uu = await apiGET('/user');
        groupsArray =
          uu && uu.user && Array.isArray(uu.user.groups)
            ? uu.user.groups
            : groupsArray;
      } catch (_) {}
      groupIndex = groupsArray.findIndex(
        (g) => (g.title || '') === savedProjectsTitle,
      );
    }
    const created = await apiPOST('/collection', { title: name });
    const createdItem = created && (created.item || created.data || created);
    const projectCollectionId =
      createdItem && (createdItem._id ?? createdItem.id);
    if (projectCollectionId == null)
      throw new Error('Failed to create collection');
    try {
      const newGroups = groupsArray.slice();
      const entry = {
        ...(newGroups[groupIndex] || {
          title: savedProjectsTitle,
          collections: [],
        }),
      };
      const cols = Array.isArray(entry.collections)
        ? entry.collections.slice()
        : [];
      const filtered = cols.filter((cid) => cid !== projectCollectionId);
      entry.collections = [projectCollectionId, ...filtered];
      newGroups[groupIndex] = entry;
      await apiPUT('/user', { groups: newGroups });
    } catch (_) {}
    const body = {
      items: items.map((it) => ({
        link: it.link,
        title: it.title,
        note: it.note,
        collection: { $id: Number(projectCollectionId) },
      })),
    };
    try {
      await apiPOST('/raindrops', body);
    } catch (_) {
      for (const it of items) {
        try {
          await apiPOST('/raindrop', {
            link: it.link,
            title: it.title,
            note: it.note,
            collection: { $id: Number(projectCollectionId) },
            pleaseParse: {},
          });
        } catch (_) {}
      }
    }
    setBadge('✔️', '#22c55e');
    scheduleClearBadge(3000);
    try {
      const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
      chrome.notifications?.create(
        `project-saved-${projectCollectionId}`,
        {
          type: 'basic',
          iconUrl,
          title: 'Raindrop Bear',
          message: `Saved ${items.length} tab${
            items.length > 1 ? 's' : ''
          } to ${savedProjectsTitle}/${name}`,
          priority: 0,
        },
        () => {},
      );
    } catch (_) {}
  } catch (e) {
    setBadge('😵', '#ef4444');
    scheduleClearBadge(3000);
    try {
      notify(`Failed to save project: ${e}`);
    } catch (_) {}
  }
}

export async function replaceSavedProjectWithTabs(
  chrome,
  collectionId,
  tabsList,
) {
  const oldId = Number(collectionId);
  if (!Number.isFinite(oldId)) return { title: 'Project', count: 0 };
  const eligibleTabs = (tabsList || []).filter(
    (t) =>
      t.url && (t.url.startsWith('https://') || t.url.startsWith('http://')),
  );
  if (eligibleTabs.length === 0) throw new Error('No eligible http(s) tabs');
  const groupsInWindow = await new Promise((resolve) =>
    chrome.tabGroups?.query(
      { windowId: chrome.windows.WINDOW_ID_CURRENT },
      (gs) => resolve(gs || []),
    ),
  );
  const groupIdToMeta = new Map();
  (groupsInWindow || []).forEach((g) => groupIdToMeta.set(g.id, g));
  const items = eligibleTabs.map((t, i) => {
    const baseTitle = t.title || t.url || '';
    const group = groupIdToMeta.get(t.groupId) || null;
    const meta = {
      index: i,
      pinned: t.pinned,
      tabGroup: group && group.title,
      tabGroupColor: group && group.color,
    };
    return { link: t.url, title: baseTitle, note: JSON.stringify(meta) };
  });
  const [userRes, rootsRes] = await Promise.all([
    apiGET('/user'),
    apiGET('/collections'),
  ]);
  const groups = Array.isArray(userRes?.user?.groups)
    ? userRes.user.groups
    : [];
  const savedIdx = groups.findIndex((g) => (g && g.title) === '🐻‍❄️ Projects');
  const savedGroup = savedIdx >= 0 ? groups[savedIdx] : null;
  const order = Array.isArray(savedGroup?.collections)
    ? savedGroup.collections.slice()
    : [];
  const pos = order.findIndex((cid) => Number(cid) === oldId);
  const roots = Array.isArray(rootsRes?.items) ? rootsRes.items : [];
  const existing = roots.find((c) => Number(c?._id) === oldId);
  const title = existing?.title || 'Project';
  const existingCoverArray = Array.isArray(existing?.cover)
    ? existing.cover.filter(Boolean)
    : existing?.cover
    ? [existing.cover]
    : [];
  const created = await apiPOST('/collection', { title });
  const createdItem = created && (created.item || created.data || created);
  const newId = createdItem && (createdItem._id ?? createdItem.id);
  if (newId == null) throw new Error('Failed to create collection');
  if (existingCoverArray.length > 0) {
    try {
      await apiPUT(`/collection/${encodeURIComponent(newId)}`, {
        cover: existingCoverArray,
      });
    } catch (_) {}
  }
  try {
    if (savedIdx >= 0) {
      const newGroups = groups.slice();
      const entry = {
        ...(newGroups[savedIdx] || {
          title: '🐻‍❄️ Projects',
          collections: [],
        }),
      };
      const cols = Array.isArray(entry.collections)
        ? entry.collections.slice()
        : [];
      if (pos >= 0) {
        cols.splice(pos, 1, Number(newId));
      } else {
        const filtered = cols.filter((cid) => Number(cid) !== Number(newId));
        filtered.unshift(Number(newId));
        entry.collections = filtered;
      }
      if (pos >= 0) entry.collections = cols;
      newGroups[savedIdx] = entry;
      await apiPUT('/user', { groups: newGroups });
    }
  } catch (_) {}
  try {
    await apiPOST('/raindrops', {
      items: items.map((it) => ({
        link: it.link,
        title: it.title,
        note: it.note,
        collection: { $id: Number(newId) },
        pleaseParse: {},
      })),
    });
  } catch (_) {
    for (const it of items) {
      try {
        await apiPOST('/raindrop', {
          link: it.link,
          title: it.title,
          note: it.note,
          collection: { $id: Number(newId) },
          pleaseParse: {},
        });
      } catch (_) {}
    }
  }
  try {
    await apiDELETE(`/collection/${encodeURIComponent(oldId)}`);
  } catch (_) {}

  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      `project-saved-${newId}`,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear',
        message: `Replaced project "${title}" with ${items.length} tab${
          items.length > 1 ? 's' : ''
        }.`,
        priority: 0,
      },
      () => {},
    );
  } catch (_) {}

  return { title, count: items.length };
}

export async function addTabsToProject(chrome, collectionId, tabsList) {
  const colId = Number(collectionId);
  if (!Number.isFinite(colId)) return { title: 'Project', count: 0 };

  const eligibleTabs = (tabsList || []).filter(
    (t) =>
      t.url && (t.url.startsWith('https://') || t.url.startsWith('http://')),
  );
  if (eligibleTabs.length === 0) throw new Error('No eligible http(s) tabs');

  const groupsInWindow = await new Promise((resolve) =>
    chrome.tabGroups?.query(
      { windowId: chrome.windows.WINDOW_ID_CURRENT },
      (gs) => resolve(gs || []),
    ),
  );
  const groupIdToMeta = new Map();
  (groupsInWindow || []).forEach((g) => groupIdToMeta.set(g.id, g));

  // get existing items
  const existingItemsRes = await apiGET(
    `/raindrops/${encodeURIComponent(colId)}`,
  );
  const existingItems =
    existingItemsRes && Array.isArray(existingItemsRes.items)
      ? existingItemsRes.items
      : [];
  const existingItemsCount = existingItems.length;

  let sharedTabGroupInfo = undefined;
  let firstParsedItem = undefined;
  const tabGroupsOfExistingItems = existingItems.map((item) => {
    try {
      const meta = JSON.parse(item.note);
      if (firstParsedItem === undefined) {
        firstParsedItem = meta;
      }
      return meta.tabGroup;
    } catch (e) {
      return null;
    }
  });

  const uniqueTabGroups = [...new Set(tabGroupsOfExistingItems)];

  if (uniqueTabGroups.length === 1) {
    const tabGroup = uniqueTabGroups[0];
    const { tabGroupColor = null } = firstParsedItem || {};
    sharedTabGroupInfo = {
      tabGroup,
      tabGroupColor,
    };
  }

  const newTabsAreUngrouped = eligibleTabs.every(
    (t) => !groupIdToMeta.has(t.groupId),
  );

  const shouldAssignGroup = newTabsAreUngrouped && sharedTabGroupInfo;

  const items = eligibleTabs.map((t, i) => {
    const baseTitle = t.title || t.url || '';
    const group = groupIdToMeta.get(t.groupId) || null;
    const meta = {
      index: existingItemsCount + i,
      pinned: t.pinned,
      tabGroup: group && group.title,
      tabGroupColor: group && group.color,
    };
    if (shouldAssignGroup) {
      meta.tabGroup = sharedTabGroupInfo?.tabGroup;
      meta.tabGroupColor = sharedTabGroupInfo?.tabGroupColor;
    }
    return { link: t.url, title: baseTitle, note: JSON.stringify(meta) };
  });

  try {
    await apiPOST('/raindrops', {
      items: items.map((it) => ({
        link: it.link,
        title: it.title,
        note: it.note,
        collection: { $id: Number(colId) },
        pleaseParse: {},
      })),
    });
  } catch (_) {
    for (const it of items) {
      try {
        await apiPOST('/raindrop', {
          link: it.link,
          title: it.title,
          note: it.note,
          collection: { $id: Number(colId) },
          pleaseParse: {},
        });
      } catch (_) {}
    }
  }

  try {
    const collection = await apiGET(`/collection/${encodeURIComponent(colId)}`);
    const title = collection?.item?.title || 'Project';
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      `project-saved-${colId}`,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear',
        message: `Added ${items.length} tab${
          items.length > 1 ? 's' : ''
        } to project "${title}".`,
        priority: 0,
      },
      () => {},
    );
  } catch (_) {}

  return { title: 'Project', count: items.length };
}
