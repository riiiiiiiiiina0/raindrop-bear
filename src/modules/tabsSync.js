import { chromeP } from './chrome.js';
import { apiGET, apiPOST, apiPUT, apiDELETE } from './raindrop.js';

// ===== Configuration =====

/**
 * Loads the tabs sync configuration from storage.
 *
 * @returns {Promise<{enabled: boolean, groupTitle: string}>}
 */
export async function loadTabsConfig() {
  try {
    const data = await chromeP.storageGet(['tabsSyncEnabled', 'tabsGroupTitle']);
    return {
      enabled: data?.tabsSyncEnabled ?? true, // Default to enabled
      groupTitle: data?.tabsGroupTitle?.trim() || 'Browser tabs', // Default title
    };
  } catch (error) {
    console.error('Failed to load tabs sync config:', error);
    return {
      enabled: false,
      groupTitle: 'Browser tabs',
    };
  }
}

// ===== Index Prefix Helpers =====

const INDEX_REGEX = /^\[(\d+)\]\s*(.*)$/;

/**
 * Parses a title with an index prefix like "[0] Title".
 *
 * @param {string} title The title to parse.
 * @returns {{index: number, title: string} | null} Parsed index and base title, or null if no prefix.
 */
export function parseIndexPrefix(title) {
  if (!title) return null;
  const match = title.match(INDEX_REGEX);
  if (match) {
    return {
      index: parseInt(match[1], 10),
      title: match[2],
    };
  }
  return null;
}

/**
 * Formats a title with an index prefix.
 *
 * @param {number} index The index.
 * @param {string} baseTitle The base title.
 * @returns {string} The formatted title, e.g., "[0] My Title".
 */
export function formatIndexedTitle(index, baseTitle) {
  return `[${index}] ${baseTitle}`;
}

// ===== Cloud Model =====

/**
 * Fetches the entire cloud model for tabs and groups from Raindrop.
 */
export async function fetchTabsCloudModel(groupTitle) {
  // 1. Find the group for tab sync
  const userRes = await apiGET('/user');
  const tabGroup = userRes?.user?.groups?.find(g => g.title === groupTitle);
  if (!tabGroup || !tabGroup.collections?.length) {
    return { windows: [] }; // No group or group is empty
  }
  const windowCollectionIds = new Set(tabGroup.collections);

  // 2. Fetch all collections (root and children)
  const [rootCollectionsRes, childCollectionsRes] = await Promise.all([
    apiGET('/collections'),
    apiGET('/collections/childrens'),
  ]);
  const allCollections = [
    ...(rootCollectionsRes?.items || []),
    ...(childCollectionsRes?.items || [])
  ];

  // 3. Identify window collections
  const windowCollections = (rootCollectionsRes?.items || []).filter(c => windowCollectionIds.has(c._id));

  const cloudModel = { windows: [] };

  // 4. For each window, fetch its contents
  for (const winCollection of windowCollections) {
    const windowId = winCollection._id;
    const parsedWindow = parseIndexPrefix(winCollection.title);

    const windowModel = {
      id: windowId,
      title: parsedWindow ? parsedWindow.title : winCollection.title,
      index: parsedWindow ? parsedWindow.index : -1,
      groups: [],
      pinned: [],
      ungrouped: [],
    };

    // Fetch raindrops and child collections for this window
    const [raindropsRes, childrenCollections] = await Promise.all([
        apiGET(`/raindrops/${windowId}?perpage=500`),
        Promise.resolve(allCollections.filter(c => c.parent?.$id === windowId))
    ]);

    // Ungrouped tabs are direct children of the window collection
    const ungroupedTabs = raindropsRes?.items || [];
    for (const tabItem of ungroupedTabs) {
        if (isValidUrl(tabItem.link)) {
            const parsed = parseIndexPrefix(tabItem.title);
            windowModel.ungrouped.push({
                id: tabItem._id,
                url: tabItem.link,
                title: parsed ? parsed.title : tabItem.title,
                index: parsed ? parsed.index : -1,
            });
        }
    }

    // Process tab groups (child collections)
    for (const groupCollection of childrenCollections) {
      const parsedGroup = parseIndexPrefix(groupCollection.title);

      // Special case: Pinned tabs collection
      if (parsedGroup && parsedGroup.title === '**Pinned**') {
        const pinnedTabsRes = await apiGET(`/raindrops/${groupCollection._id}?perpage=500`);
        for (const pinnedItem of pinnedTabsRes?.items || []) {
          if (isValidUrl(pinnedItem.link)) {
            const parsed = parseIndexPrefix(pinnedItem.title);
            windowModel.pinned.push({
              id: pinnedItem._id,
              url: pinnedItem.link,
              title: parsed ? parsed.title : pinnedItem.title,
              index: parsed ? parsed.index : -1,
            });
          }
        }
      } else { // Regular tab group
        const groupModel = {
          id: groupCollection._id,
          title: parsedGroup ? parsedGroup.title : groupCollection.title,
          index: parsedGroup ? parsedGroup.index : -1,
          tabs: [],
        };

        const groupTabsRes = await apiGET(`/raindrops/${groupCollection._id}?perpage=500`);
        for (const tabItem of groupTabsRes?.items || []) {
          if (isValidUrl(tabItem.link)) {
            const parsed = parseIndexPrefix(tabItem.title);
            groupModel.tabs.push({
              id: tabItem._id,
              url: tabItem.link,
              title: parsed ? parsed.title : tabItem.title,
              index: parsed ? parsed.index : -1,
            });
          }
        }
        // sort tabs within group
        groupModel.tabs.sort((a, b) => a.index - b.index);
        windowModel.groups.push(groupModel);
      }
    }

    // Sort all items by index
    windowModel.pinned.sort((a, b) => a.index - b.index);
    windowModel.groups.sort((a, b) => a.index - b.index);
    windowModel.ungrouped.sort((a, b) => a.index - b.index);

    cloudModel.windows.push(windowModel);
  }

  // Sort windows by index
  cloudModel.windows.sort((a, b) => a.index - b.index);

  return cloudModel;
}

// ===== Browser Model =====

/**
 * Reads the current state of browser windows, tabs, and groups.
 */
export async function readBrowserModel() {
  const windows = await chromeP.windowsGetAll({ populate: true, windowTypes: ['normal'] });
  const tabGroups = await chromeP.tabGroupsQuery({});
  const groupsById = new Map(tabGroups.map(g => [g.id, g]));

  const browserModel = {
    windows: windows.map(win => {
      const windowModel = {
        id: win.id,
        title: `Window`, // A default title, can be improved
        focused: win.focused,
        tabs: [],
        groups: new Map(),
      };

      for (const tab of win.tabs) {
        if (isValidUrl(tab.url)) {
          const tabModel = {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            pinned: tab.pinned,
            groupId: tab.groupId,
            index: tab.index,
          };
          windowModel.tabs.push(tabModel);

          if (tab.groupId) {
            if (!windowModel.groups.has(tab.groupId)) {
              const group = groupsById.get(tab.groupId);
              windowModel.groups.set(tab.groupId, {
                id: group.id,
                title: group.title,
                color: group.color,
                tabs: [],
              });
            }
            windowModel.groups.get(tab.groupId).tabs.push(tabModel);
          }
        }
      }
      return windowModel;
    }),
  };

  return browserModel;
}

// ===== Reconciliation =====

let suppressLocalTabEvents = false;

/**
 * Applies the cloud model to the browser, creating/updating/moving entities.
 */
export async function applyCloudToBrowser(cloudModel) {
  if (suppressLocalTabEvents) return;
  suppressLocalTabEvents = true;

  try {
    const state = await loadTabsState();
    const browserModel = await readBrowserModel();
    const raindropIdToBrowserId = new Map(Object.entries(state.windowMap));

    for (const win of cloudModel.windows) {
      const existingWindowId = raindropIdToBrowserId.get(String(win.id));
      const browserWindow = browserModel.windows.find(w => w.id === existingWindowId);

      if (browserWindow) {
        console.log(`Window ${win.id} already exists as browser window ${browserWindow.id}. Reconciliation logic to be implemented.`);
        // TODO: Reconcile tabs and groups within the existing window.
      } else {
        console.log(`Creating new window for Raindrop collection ${win.id}`);
        // Create new window
        const allTabs = [
            ...win.pinned,
            ...win.ungrouped,
            ...win.groups.flatMap(g => g.tabs)
        ];
        const newWindow = await chromeP.windowsCreate({
            url: allTabs.map(t => t.url).filter(isValidUrl),
        });

        state.windowMap[String(win.id)] = newWindow.id;

        // After creation, we need to get the new tabs to pin them and group them.
        const createdTabs = newWindow.tabs;
        const urlToTabId = new Map(createdTabs.map(t => [t.url, t.id]));

        // Pin tabs
        for (const pinnedTab of win.pinned) {
            const tabId = urlToTabId.get(pinnedTab.url);
            if (tabId) {
                await chromeP.tabsUpdate(tabId, { pinned: true });
                state.itemMap[String(pinnedTab.id)] = tabId;
            }
        }

        // Group tabs
        for (const group of win.groups) {
            const tabIdsToGroup = group.tabs.map(t => urlToTabId.get(t.url)).filter(Boolean);
            if (tabIdsToGroup.length > 0) {
                const newGroupId = await chromeP.tabsGroup({ tabIds: tabIdsToGroup, windowId: newWindow.id });
                await chromeP.tabGroupsUpdate(newGroupId, { title: group.title });
                state.groupCollectionMap[String(group.id)] = newGroupId;
            }
        }
      }
    }
    await saveTabsState(state);
  } catch (error) {
    console.error('Error applying cloud model to browser:', error);
  } finally {
    suppressLocalTabEvents = false;
  }
}

async function recalculateAndApplyPrefixes(windowId) {
    // This is a demonstration of the prefixing logic.
    // A real implementation would need access to the window-to-collection maps.
    console.log(`Recalculating prefixes for window ${windowId}`);

    const browserModel = await readBrowserModel();
    const windowModel = browserModel.windows.find(w => w.id === windowId);
    if (!windowModel) return;

    let currentIndex = 0;

    // Pinned tabs are always first
    const pinnedTabs = windowModel.tabs.filter(t => t.pinned);
    if (pinnedTabs.length > 0) {
        console.log(`Would create/update **Pinned** collection at index 0`);
        pinnedTabs.forEach((tab, i) => {
            const newTitle = formatIndexedTitle(i, tab.title);
            console.log(`  - Would update tab ${tab.id} to have title "${newTitle}"`);
        });
        currentIndex++;
    }

    // Unpinned tabs and groups
    const unpinnedTabs = windowModel.tabs.filter(t => !t.pinned);
    const processedGroupIds = new Set();

    for (const tab of unpinnedTabs) {
        if (tab.groupId) {
            if (!processedGroupIds.has(tab.groupId)) {
                processedGroupIds.add(tab.groupId);
                const group = windowModel.groups.get(tab.groupId);
                const newTitle = formatIndexedTitle(currentIndex, group.title);
                console.log(`Would update group ${group.id} to have title "${newTitle}"`);
                currentIndex++;

                group.tabs.forEach((groupTab, i) => {
                    const newTabTitle = formatIndexedTitle(i, groupTab.title);
                    console.log(`  - Would update tab ${groupTab.id} in group ${group.id} to have title "${newTabTitle}"`);
                });
            }
        } else {
            const newTitle = formatIndexedTitle(currentIndex, tab.title);
            console.log(`Would update ungrouped tab ${tab.id} to have title "${newTitle}"`);
            currentIndex++;
        }
    }
}

/**
 * Mirrors changes from a browser event to the Raindrop cloud.
 */
export async function mirrorBrowserToCloud(event) {
    if (suppressLocalTabEvents) return;

    const { enabled, groupTitle } = await loadTabsConfig();
    if (!enabled) {
        return;
    }

    console.log('Mirroring event to cloud:', event);
    const state = await loadTabsState();

    switch (event.event) {
        case 'window.onCreated':
            {
                const window = event.window;
                const newCollection = await apiPOST('/collection', { title: 'New Window' });
                state.windowMap[String(window.id)] = newCollection.item._id;
                await saveTabsState({ windowMap: state.windowMap });
                await recalculateAndApplyPrefixes(window.id);
            }
            break;

        case 'tab.onCreated':
            {
                const tab = event.tab;
                if (!isValidUrl(tab.url)) break;

                const windowCollectionId = state.windowMap[String(tab.windowId)];
                if (windowCollectionId) {
                    const newRaindrop = await apiPOST('/raindrop', {
                        link: tab.url,
                        title: tab.title,
                        collection: { $id: windowCollectionId },
                    });
                    state.itemMap[String(tab.id)] = newRaindrop.item._id;
                    await saveTabsState({ itemMap: state.itemMap });
                    await recalculateAndApplyPrefixes(tab.windowId);
                }
            }
            break;

        default:
            console.log(`Unhandled event type: ${event.event}`);
            break;
    }
}

// ===== State Management =====

const TABS_STORAGE_KEYS = {
    tabsWindowMap: 'tabsWindowMap',
    tabsGroupCollectionMap: 'tabsGroupCollectionMap',
    tabsItemMap: 'tabsItemMap',
    tabsLastSync: 'tabsLastSync',
};

export async function loadTabsState() {
    const data = await chromeP.storageGet(Object.values(TABS_STORAGE_KEYS));
    return {
        windowMap: data.tabsWindowMap || {},
        groupCollectionMap: data.tabsGroupCollectionMap || {},
        itemMap: data.tabsItemMap || {},
        lastSync: data.tabsLastSync || null,
    };
}

export async function saveTabsState(partial) {
    const toSave = {};
    for (const [key, value] of Object.entries(partial)) {
        if (TABS_STORAGE_KEYS[key]) {
            toSave[TABS_STORAGE_KEYS[key]] = value;
        }
    }
    if (Object.keys(toSave).length > 0) {
        await chromeP.storageSet(toSave);
    }
}

// ===== URL Filtering =====

/**
 * Checks if a URL is valid for syncing (http or https).
 *
 * @param {string | undefined} url The URL to check.
 * @returns {boolean} True if the URL is valid.
 */
export function isValidUrl(url) {
    return url?.startsWith('http:') || url?.startsWith('https:') || false;
}
