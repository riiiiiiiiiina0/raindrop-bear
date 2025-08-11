// Raindrop Bear Background Service Worker (Manifest V3)
// Periodically sync Raindrop.io collections and bookmarks into Chrome bookmarks

// ===== Configuration =====
import {
  apiGET as raindropGET,
  setApiToken as setRaindropToken,
  loadTokenIfNeeded,
  apiPOST as raindropPOST,
  apiPUT as raindropPUT,
  apiDELETE as raindropDELETE,
} from './modules/raindrop.js';
// API token is loaded from storage (set via Options page)
let RAINDROP_API_TOKEN = '';
import {
  notifyMissingOrInvalidToken,
  TOKEN_NOTIFICATION_ID,
  notifySyncSuccess,
  notifySyncFailure,
  SYNC_SUCCESS_NOTIFICATION_ID,
  notify,
} from './modules/notifications.js';

const ALARM_NAME = 'raindrop-sync';
const SYNC_PERIOD_MINUTES = 10;
const BADGE_CLEAR_ALARM = 'raindrop-clear-badge';

const STORAGE_KEYS = {
  lastSync: 'lastSync',
  collectionMap: 'collectionMap', // { [collectionId: string]: chromeFolderId: string }
  groupMap: 'groupMap', // { [groupTitle: string]: chromeFolderId: string }
  itemMap: 'itemMap', // { [raindropItemId: string]: chromeBookmarkId: string }
  rootFolderId: 'rootFolderId', // chrome folder id for the Raindrop root
  tabsSyncEnabled: 'tabsSyncEnabled',
  tabsGroupTitle: 'tabsGroupTitle',
  tabsWindowMap: 'tabsWindowMap',
  tabsGroupCollectionMap: 'tabsGroupCollectionMap',
  tabsItemMap: 'tabsItemMap',
  tabsLastSync: 'tabsLastSync',
};

import {
  ROOT_FOLDER_NAME,
  UNSORTED_COLLECTION_ID,
  getOrCreateRootFolder as bmGetOrCreateRootFolder,
  getOrCreateChildFolder as bmGetOrCreateChildFolder,
  getBookmarksBarFolderId,
  removeLegacyTopFolders,
} from './modules/bookmarks.js';

// Concurrency guard (service worker scope)
let isSyncing = false;
let suppressLocalBookmarkEvents = false; // guard to avoid feedback loops for local→remote during extension-initiated changes

import { chromeP } from './modules/chrome.js';

import {
  loadTabsConfig,
  mirrorBrowserToCloud,
  fetchTabsCloudModel,
  applyCloudToBrowser,
  readBrowserModel,
} from './modules/tabsSync.js';

// ===== Types =====

/**
 * Raindrop "Groups" entry.
 * See: GET /user → user.groups
 * @typedef {Object} RaindropGroup
 * @property {string} title - Name of group
 * @property {number} [sort] - Ascending order position
 * @property {number[]} [collections] - Ordered list of root collection IDs
 */

/**
 * Raindrop user object (shape of `GET /user` response at `user`).
 * Only the fields relevant to this extension are included here.
 * @typedef {Object} RaindropUser
 * @property {number} _id - Unique user ID
 * @property {string} [email]
 * @property {string} [email_MD5]
 * @property {string} [fullName]
 * @property {RaindropGroup[]} [groups]
 */

/**
 * Raindrop collection object (as returned by collections endpoints).
 * @typedef {Object} RaindropCollection
 * @property {number} _id - The id of the collection.
 * @property {number} [count] - Number of raindrops in the collection.
 * @property {string[]} [cover] - Collection cover URL(s). Array typically contains one item for legacy reasons.
 * @property {string} [created] - When the collection was created (ISO string).
 * @property {string} [lastUpdate] - When the collection was last updated (ISO string).
 * @property {Object} [parent] - Parent collection reference object (missing for roots).
 * @property {number} [parent.$id] - The id of the parent collection. Not specified for root collections.
 * @property {number} [sort] - Order among siblings with the same parent (descending).
 * @property {string} [title] - Name of the collection.
 */

/**
 * Raindrop item (bookmark). We call bookmarks/items as "raindrops".
 * @typedef {Object} RaindropItem
 * @property {number} _id - Unique identifier
 * @property {Object} [collection] - Collection reference object
 * @property {number} [collection.$id] - Collection that the raindrop resides in
 * @property {string} [cover] - Raindrop cover URL
 * @property {string} [created] - Creation date (ISO string)
 * @property {string} [excerpt] - Description (max 10000)
 * @property {string} [note] - Note (max 10000)
 * @property {string} [lastUpdate] - Update date (ISO string)
 * @property {string} [link] - URL
 * @property {string[]} [tags] - Tags list
 * @property {string} [title] - Title (max 1000)
 * @property {('link'|'article'|'image'|'video'|'document'|'audio')} [type] - Item type
 * @property {boolean} [important] - Marked as favorite
 */

// ===== Utility: Fetch wrapper for Raindrop API =====

/**
 * Perform a GET request to the Raindrop API.
 *
 * @param {string} pathWithQuery - The API path (with optional query string) to request, e.g. "/collections".
 * @returns {Promise<any>} Resolves with the parsed JSON response from the API.
 * @throws {Error} Throws an error if the API response is not OK, including the status and error text.
 */
async function apiGET(pathWithQuery) {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
  }
  if (!RAINDROP_API_TOKEN) {
    notifyMissingOrInvalidToken(
      'No API token configured. Please add your Raindrop API token.',
    );
    throw new Error('Missing Raindrop API token');
  }
  try {
    setRaindropToken(RAINDROP_API_TOKEN);
    return await raindropGET(pathWithQuery);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

async function apiPOST(path, body) {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
  }
  if (!RAINDROP_API_TOKEN) {
    notifyMissingOrInvalidToken(
      'No API token configured. Please add your Raindrop API token.',
    );
    throw new Error('Missing Raindrop API token');
  }
  try {
    setRaindropToken(RAINDROP_API_TOKEN);
    return await raindropPOST(path, body);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

async function apiPUT(path, body) {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
  }
  if (!RAINDROP_API_TOKEN) {
    notifyMissingOrInvalidToken(
      'No API token configured. Please add your Raindrop API token.',
    );
    throw new Error('Missing Raindrop API token');
  }
  try {
    setRaindropToken(RAINDROP_API_TOKEN);
    return await raindropPUT(path, body);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

async function apiDELETE(path) {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
  }
  if (!RAINDROP_API_TOKEN) {
    notifyMissingOrInvalidToken(
      'No API token configured. Please add your Raindrop API token.',
    );
    throw new Error('Missing Raindrop API token');
  }
  try {
    setRaindropToken(RAINDROP_API_TOKEN);
    return await raindropDELETE(path);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

// ===== UI Badge Helpers =====
function setBadge(text, backgroundColor) {
  try {
    chrome.action?.setBadgeText({ text: text || '' });
    if (backgroundColor) {
      chrome.action?.setBadgeBackgroundColor({ color: backgroundColor });
    }
  } catch (_) {}
}

function clearBadge() {
  try {
    chrome.action?.setBadgeText({ text: '' });
  } catch (_) {}
}

function scheduleClearBadge(delayMs) {
  try {
    chrome.alarms.clear('raindrop-clear-badge', () => {
      try {
        chrome.alarms.create('raindrop-clear-badge', {
          when: Date.now() + Math.max(0, delayMs || 0),
        });
      } catch (_) {}
    });
  } catch (_) {}
}

/**
 * Show a notification prompting the user to configure their Raindrop API token.
 * Clicking the notification opens the extension Options page.
 * Debounced to avoid spamming.
 * @param {string} message
 */
// notification helper moved to modules/notifications

// ===== Storage Helpers =====
/**
 * Loads persisted sync state from `chrome.storage.local`.
 *
 * Keys returned:
 * - `lastSync`: ISO string of the last successful sync, or null
 * - `collectionMap`: Record mapping Raindrop collectionId → Chrome folder id
 * - `groupMap`: Record mapping group title → Chrome folder id
 * - `itemMap`: Record mapping raindrop _id → Chrome bookmark id
 * - `rootFolderId`: Chrome folder id of the Raindrop root, or null
 *
 * @returns {Promise<{
 *   lastSync: (string|null),
 *   collectionMap: Record<string,string>,
 *   groupMap: Record<string,string>,
 *   itemMap: Record<string,string>,
 *   rootFolderId: (string|null)
 * }>} The loaded state with sensible defaults when missing.
 */
async function loadState() {
  const data = await chromeP.storageGet([
    STORAGE_KEYS.lastSync,
    STORAGE_KEYS.collectionMap,
    STORAGE_KEYS.groupMap,
    STORAGE_KEYS.itemMap,
    STORAGE_KEYS.rootFolderId,
  ]);

  return {
    lastSync: data[STORAGE_KEYS.lastSync] || null,
    collectionMap: data[STORAGE_KEYS.collectionMap] || {},
    groupMap: data[STORAGE_KEYS.groupMap] || {},
    itemMap: data[STORAGE_KEYS.itemMap] || {},
    rootFolderId: data[STORAGE_KEYS.rootFolderId] || null,
  };
}

/**
 * Saves a partial state object to Chrome storage.
 *
 * For each key in the provided partial object, if the key matches a key in STORAGE_KEYS,
 * it will be mapped to the corresponding storage key name. Otherwise, the key is used as-is,
 * allowing direct storage key names as well.
 *
 * @param {Object} partial - An object containing state properties to save. Keys can be logical state keys or direct storage key names.
 * @returns {Promise<void>} Resolves when the state has been saved to storage.
 */
async function saveState(partial) {
  const toSave = {};
  for (const [k, v] of Object.entries(partial)) {
    if (k in STORAGE_KEYS) {
      toSave[STORAGE_KEYS[k]] = v;
    } else {
      // Accept direct storage key names too
      toSave[k] = v;
    }
  }
  await chromeP.storageSet(toSave);
}

// ===== Bookmarks Helpers =====
/**
 * Resolves the Chrome "Bookmarks Bar" folder id in a robust way.
 *
 * Chrome commonly uses id "2", but this is not guaranteed. This function
 * reads the bookmarks tree and finds a node named like "Other" as a fallback.
 *
 * @returns {Promise<string>} The id of the "Bookmarks Bar" folder.
 */
// delegated to modules/bookmarks.js

/**
 * Gets the id of the extension's root folder ("Raindrop Bookmarks"),
 * creating it under "Bookmarks Bar" if it does not exist.
 *
 * The id is persisted in storage and validated on each call.
 *
 * @returns {Promise<string>} The Chrome bookmarks folder id for the root.
 */
async function getOrCreateRootFolder() {
  return bmGetOrCreateRootFolder(loadState, saveState);
}

/**
 * Retrieves the ID of a child folder with the specified title under the given parent folder.
 * If such a folder does not exist, it creates one and returns its ID.
 *
 * @param {string} parentId - The ID of the parent bookmark folder.
 * @param {string} title - The title of the child folder to find or create.
 * @returns {Promise<string>} The ID of the found or newly created child folder.
 */
const getOrCreateChildFolder = bmGetOrCreateChildFolder;

// ===== Raindrop Collections and Groups =====
/**
 * Fetches Raindrop groups and collections from the API.
 *
 * - Retrieves user groups from `/user`
 * - Retrieves root collections from `/collections`
 * - Retrieves nested (child) collections from `/collections/childrens`
 *
 * @returns {Promise<{
 *   groups: RaindropGroup[],
 *   rootCollections: RaindropCollection[],
 *   childCollections: RaindropCollection[]
 * }>} An object containing arrays of groups, root collections, and child collections.
 */
async function fetchGroupsAndCollections() {
  // /user for groups, /collections for root, /collections/childrens for nested
  const [userRes, rootsRes, childrenRes] = await Promise.all([
    apiGET('/user'),
    apiGET('/collections'),
    apiGET('/collections/childrens'),
  ]);

  const groups =
    userRes && userRes.user && Array.isArray(userRes.user.groups)
      ? userRes.user.groups
      : [];
  const rootCollections =
    rootsRes && (rootsRes.items || rootsRes.result) ? rootsRes.items || [] : [];
  const childCollections =
    childrenRes && (childrenRes.items || childrenRes.result)
      ? childrenRes.items || []
      : [];

  return { groups, rootCollections, childCollections };
}

/**
 * Builds an index of Raindrop collections by their ID.
 *
 * This function takes arrays of root and child collections and constructs a Map
 * where each key is a collection's ID and the value is an object containing the collection's
 * id, title, and parentId (null for root collections).
 *
 * @param {RaindropCollection[]} rootCollections - Array of root collection objects.
 * @param {RaindropCollection[]} childCollections - Array of child (nested) collection objects.
 * @returns {Map<number, {id: number, title: string, parentId: (number|null), sort: (number|undefined)}>}
 *   Map from collection ID to an object with id, title, parentId, and sort.
 */
function buildCollectionsIndex(rootCollections, childCollections) {
  const byId = new Map();
  for (const c of rootCollections) {
    if (!c || c._id == null) continue;
    byId.set(c._id, {
      id: c._id,
      title: c.title || '',
      parentId: null,
      sort: typeof c.sort === 'number' ? c.sort : undefined,
    });
  }
  for (const c of childCollections) {
    if (!c || c._id == null) continue;
    const parentId =
      (c.parent && (c.parent.$id != null ? c.parent.$id : c.parent)) || null;
    byId.set(c._id, {
      id: c._id,
      title: c.title || '',
      parentId,
      sort: typeof c.sort === 'number' ? c.sort : undefined,
    });
  }
  return byId; // Map<number, {id, title, parentId}>
}

/**
 * Builds a map from root collection IDs to their corresponding group titles.
 *
 * This function processes the array of Raindrop groups (from /user.groups) and
 * creates a Map where each key is a root collection ID and the value is the group title
 * that the collection belongs to.
 *
 * @param {RaindropGroup[]} groups - Array of Raindrop group objects.
 * @returns {Map<number, string>} Map from root collection ID to group title.
 */
function buildCollectionToGroupMap(groups) {
  // Map each root collection id to group title according to /user.groups
  const map = new Map(); // Map<number, string>
  for (const g of groups || []) {
    const title = g && g.title ? g.title : '';
    const ids = Array.isArray(g.collections) ? g.collections : [];
    for (const id of ids) {
      map.set(id, title);
    }
  }
  return map;
}

/**
 * Determines the group title for a given collection by traversing up to its root collection.
 *
 * This function walks up the parent chain of the specified collection until it reaches
 * a root collection (a collection with no parent). It then looks up the group title
 * associated with that root collection using the provided map.
 *
 * @param {number} collectionId - The ID of the collection to find the group for.
 * @param {Map<number, {id: number, title: string, parentId: (number|null)}>} collectionsById
 *   - Map of collection IDs to collection info objects.
 * @param {Map<number, string>} rootCollectionToGroupTitle
 *   - Map from root collection IDs to their group titles.
 * @returns {string} The group title for the collection, or an empty string if not found.
 */
function computeGroupForCollection(
  collectionId,
  collectionsById,
  rootCollectionToGroupTitle,
) {
  // Walk up to root collection, then read group title
  let currentId = collectionId;
  const visited = new Set();
  while (currentId != null && !visited.has(currentId)) {
    visited.add(currentId);
    const info = collectionsById.get(currentId);
    if (!info) break;
    if (info.parentId == null) {
      return rootCollectionToGroupTitle.get(info.id) || '';
    }
    currentId = info.parentId;
  }
  return '';
}

// ===== Folder Synchronization =====
/**
 * Resolves the root collection id for a given collection by walking parent links.
 *
 * If a cycle is detected or the chain breaks, returns null.
 *
 * @param {number} collectionId - The collection whose root to resolve.
 * @param {Map<number, {id: number, title: string, parentId: (number|null)}>} collectionsById
 *   Map of collection ids to metadata including parentId.
 * @returns {(number|null)} Root collection id, or null when not found.
 */
function computeRootCollectionId(collectionId, collectionsById) {
  let currentId = collectionId;
  const visited = new Set();
  while (currentId != null && !visited.has(currentId)) {
    visited.add(currentId);
    const info = collectionsById.get(currentId);
    if (!info) return null;
    if (info.parentId == null) return info.id;
    currentId = info.parentId;
  }
  return null;
}

/**
 * Ensures Chrome folders reflect the current Raindrop groups and collections.
 *
 * Creates/updates/moves/deletes folders as needed and updates stored maps.
 *
 * @param {RaindropGroup[]} groups - Groups returned from `/user`.
 * @param {Map<number, {id:number,title:string,parentId:(number|null),sort:(number|undefined)}>} collectionsById -
 *   Index of collections by id, including parent relationships.
 * @param {{
 *   groupMap: Record<string,string>,
 *   collectionMap: Record<string,string>,
 *   rootFolderId: (string|null)
 * }} state - Previously persisted state.
 * @returns {Promise<{rootFolderId: string, groupMap: Record<string,string>, collectionMap: Record<string,string>, didChange: boolean}>}
 *   Updated folder ids and maps, plus whether any local folder changes occurred.
 */
async function syncFolders(groups, collectionsById, state) {
  const rootFolderId = await getOrCreateRootFolder();
  const groupMap = { ...(state.groupMap || {}) };
  const collectionMap = { ...(state.collectionMap || {}) };
  let didChange = false;

  // Ensure group folders
  const currentGroupTitles = new Set();

  // Ensure special Unsorted folder exists before all groups and map it to -1
  try {
    const prevUnsorted = collectionMap[String(UNSORTED_COLLECTION_ID)];
    const unsortedId = await getOrCreateChildFolder(rootFolderId, 'Unsorted');
    if (prevUnsorted !== unsortedId) didChange = true;
    // Move to index 0 to keep before all group folders
    await chromeP.bookmarksMove(unsortedId, {
      parentId: rootFolderId,
      index: 0,
    });
    collectionMap[String(UNSORTED_COLLECTION_ID)] = unsortedId;
  } catch (_) {}
  for (const g of groups) {
    const title = g.title || '';
    currentGroupTitles.add(title);
    const folderId = await getOrCreateChildFolder(rootFolderId, title);
    groupMap[title] = folderId;
  }
  // Remove stale group folders we previously created (not present now)
  for (const [title, folderId] of Object.entries(groupMap)) {
    if (!currentGroupTitles.has(title)) {
      try {
        await chromeP.bookmarksRemoveTree(folderId);
      } catch (_) {}
      delete groupMap[title];
      didChange = true;
    }
  }

  const rootCollectionToGroupTitle = buildCollectionToGroupMap(groups);

  // Ensure collection folders (process by depth to ensure parents exist)
  const allIds = Array.from(collectionsById.keys());
  const depthMemo = new Map();
  function depthOf(id) {
    if (depthMemo.has(id)) return depthMemo.get(id);
    const info = collectionsById.get(id);
    if (!info) return 0;
    const d = info.parentId == null ? 0 : 1 + depthOf(info.parentId);
    depthMemo.set(id, d);
    return d;
  }
  allIds.sort((a, b) => depthOf(a) - depthOf(b));

  for (const id of allIds) {
    const info = collectionsById.get(id);
    if (!info) continue;
    const desiredTitle = info.title || '';
    let parentFolderId;
    if (info.parentId == null) {
      const groupTitle = rootCollectionToGroupTitle.get(id) || '';
      parentFolderId = groupMap[groupTitle] || rootFolderId; // fallback to root if group unknown
    } else {
      // New rule: if we cannot resolve a valid root for this child, discard it
      const rootId = computeRootCollectionId(id, collectionsById);
      if (rootId == null) {
        const existingFolderIdForChild = collectionMap[String(id)];
        if (existingFolderIdForChild) {
          try {
            await chromeP.bookmarksRemoveTree(existingFolderIdForChild);
          } catch (_) {}
          delete collectionMap[String(id)];
        }
        continue; // skip this child entirely
      }

      const parentFolder = collectionMap[String(info.parentId)];
      if (!parentFolder) {
        // Parent wasn't created (should not happen due to ordering); place under its group/root
        const groupTitle =
          computeGroupForCollection(
            id,
            collectionsById,
            rootCollectionToGroupTitle,
          ) || '';
        parentFolderId = groupMap[groupTitle] || rootFolderId;
      } else {
        parentFolderId = parentFolder;
      }
    }

    const existingFolderId = collectionMap[String(id)];
    if (existingFolderId) {
      // Ensure title and parent
      try {
        const nodes = await chromeP.bookmarksGet(existingFolderId);
        const node = nodes && nodes[0];
        if (node) {
          if (node.title !== desiredTitle) {
            await chromeP.bookmarksUpdate(existingFolderId, {
              title: desiredTitle,
            });
            didChange = true;
          }
          if (node.parentId !== parentFolderId) {
            await chromeP.bookmarksMove(existingFolderId, {
              parentId: parentFolderId,
            });
            didChange = true;
          }
        } else {
          // recreate
          const newNodeId = await getOrCreateChildFolder(
            parentFolderId,
            desiredTitle,
          );
          collectionMap[String(id)] = newNodeId;
          didChange = true;
        }
      } catch (_) {
        const newNodeId = await getOrCreateChildFolder(
          parentFolderId,
          desiredTitle,
        );
        collectionMap[String(id)] = newNodeId;
        didChange = true;
      }
    } else {
      const newNodeId = await getOrCreateChildFolder(
        parentFolderId,
        desiredTitle,
      );
      collectionMap[String(id)] = newNodeId;
      didChange = true;
    }
  }

  // Reorder folders to match Raindrop order semantics
  try {
    // 1) Order root collections within each group folder according to groups[].collections
    for (const g of groups || []) {
      const groupTitle = (g && g.title) || '';
      const parentFolderId = groupMap[groupTitle];
      if (!parentFolderId) continue;
      const orderedRootIds = Array.isArray(g.collections) ? g.collections : [];
      let position = 0;
      for (const rootColId of orderedRootIds) {
        const childFolderId = collectionMap[String(rootColId)];
        if (!childFolderId) continue;
        try {
          await chromeP.bookmarksMove(childFolderId, {
            parentId: parentFolderId,
            index: position,
          });
          position += 1;
        } catch (_) {}
      }
    }

    // 2) Order nested child collections by their sort (DESC) under each parent
    const childrenByParent = new Map();
    for (const info of collectionsById.values()) {
      if (info && info.parentId != null) {
        if (!childrenByParent.has(info.parentId)) {
          childrenByParent.set(info.parentId, []);
        }
        childrenByParent
          .get(info.parentId)
          .push({ id: info.id, sort: info.sort });
      }
    }

    for (const [parentCollectionId, children] of childrenByParent.entries()) {
      const parentFolderId = collectionMap[String(parentCollectionId)];
      if (!parentFolderId) continue;
      const desiredOrder = children
        .slice()
        .sort((a, b) => {
          const sa = typeof a.sort === 'number' ? a.sort : 0;
          const sb = typeof b.sort === 'number' ? b.sort : 0;
          return sa - sb; // ASC: lower sort first
        })
        .map((c) => c.id);

      let idx = 0;
      for (const childColId of desiredOrder) {
        const childFolderId = collectionMap[String(childColId)];
        if (!childFolderId) continue;
        try {
          await chromeP.bookmarksMove(childFolderId, {
            parentId: parentFolderId,
            index: idx,
          });
          idx += 1;
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Remove deleted collections (present in old map but not in current collections)
  const currentIdSet = new Set(allIds.map((n) => String(n)));
  for (const [colId, folderId] of Object.entries(collectionMap)) {
    if (String(colId) === String(UNSORTED_COLLECTION_ID)) continue; // keep special mapping
    if (!currentIdSet.has(String(colId))) {
      try {
        await chromeP.bookmarksRemoveTree(folderId);
      } catch (_) {}
      delete collectionMap[colId];
      didChange = true;
    }
  }

  await saveState({ groupMap, collectionMap, rootFolderId });
  return { rootFolderId, groupMap, collectionMap, didChange };
}

// ===== Raindrop Items (Bookmarks) Sync =====
/**
 * Extracts the collection id from a raindrop item accommodating various API shapes.
 *
 * @param {RaindropItem|any} item - Raindrop item object.
 * @returns {(number|null)} The collection id, or null if not present.
 */
function extractCollectionId(item) {
  // Try various shapes from Raindrop API
  if (item == null) return null;
  if (item.collection && item.collection.$id != null)
    return item.collection.$id;
  if (item.collectionId != null) return item.collectionId;
  if (item.collection && item.collection.id != null) return item.collection.id;
  return null;
}

/**
 * Fetches and applies new/updated raindrop items since `lastSyncISO`.
 *
 * Creates or updates Chrome bookmarks and maintains the item id → bookmark id map.
 * Paginates through `/raindrops/0` sorted by lastUpdate desc until reaching `lastSyncISO`.
 *
 * @param {(string|null)} lastSyncISO - ISO timestamp of the last successful sync.
 * @param {Record<string,string>} collectionMap - Map of collectionId → Chrome folder id.
 * @param {Record<string,string>} itemMap - Existing map of raindrop _id → Chrome bookmark id.
 * @returns {Promise<{ itemMap: Record<string,string>, newLastSyncISO: string, didChange: boolean }>} Updated map, new high-water mark, and whether any local bookmarks changed.
 */
async function syncNewAndUpdatedItems(lastSyncISO, collectionMap, itemMap) {
  let maxLastUpdate = lastSyncISO ? new Date(lastSyncISO) : new Date(0);
  let page = 0;
  let stop = false;
  const isInitial = !lastSyncISO;
  const folderInsertionCount = new Map(); // Map<string, number>
  let didChange = false;

  while (!stop) {
    const res = await apiGET(
      `/raindrops/0?sort=-lastUpdate&perpage=50&page=${page}`,
    );
    const items = Array.isArray(res.items) ? res.items : [];
    for (const item of items) {
      const itemLast = new Date(item.lastUpdate || item.lastupdate || 0);
      if (lastSyncISO && itemLast <= new Date(lastSyncISO)) {
        stop = true;
        break;
      }

      const raindropId = String(item._id);
      const collectionId = extractCollectionId(item);
      const isUnsorted =
        String(collectionId) === String(UNSORTED_COLLECTION_ID);
      let targetFolderId = null;
      let shouldSkipCreate = false;
      if (isUnsorted) {
        // Explicit Unsorted (-1) → ensure Unsorted folder
        targetFolderId = await ensureUnsortedFolder(collectionMap);
      } else {
        // For normal collections, require a mapped and existing folder
        const mapped = collectionMap[String(collectionId)] || null;
        if (mapped) {
          try {
            const nodes = await chromeP.bookmarksGet(mapped);
            if (nodes && nodes.length) {
              targetFolderId = mapped;
            } else {
              shouldSkipCreate = true;
            }
          } catch (_) {
            shouldSkipCreate = true;
          }
        } else {
          shouldSkipCreate = true;
        }
      }

      if (itemMap[raindropId]) {
        const localId = itemMap[raindropId];
        try {
          const nodes = await chromeP.bookmarksGet(localId);
          const node = nodes && nodes[0];
          if (node) {
            // Update title/url if needed
            if (
              node.title !== (item.title || '') ||
              node.url !== (item.link || item.url || '')
            ) {
              await chromeP.bookmarksUpdate(localId, {
                title: item.title || '',
                url: item.link || item.url || '',
              });
              didChange = true;
            }
            // Reposition to maintain lastUpdate DESC ordering
            if (!shouldSkipCreate && targetFolderId) {
              if (isInitial) {
                // Initial sync: append to end if folder changed
                if (node.parentId !== targetFolderId) {
                  await chromeP.bookmarksMove(localId, {
                    parentId: targetFolderId,
                  });
                  didChange = true;
                }
              } else {
                // Incremental: insert at current head slot for this folder
                const current = folderInsertionCount.get(targetFolderId) || 0;
                folderInsertionCount.set(targetFolderId, current + 1);
                await chromeP.bookmarksMove(localId, {
                  parentId: targetFolderId,
                  index: current,
                });
                didChange = true;
              }
            }
          } else {
            // Recreate
            if (!shouldSkipCreate && targetFolderId) {
              const createDetails = {
                parentId: targetFolderId,
                title: item.title || '',
                url: item.link || item.url || '',
              };
              if (!isInitial) {
                const current = folderInsertionCount.get(targetFolderId) || 0;
                folderInsertionCount.set(targetFolderId, current + 1);
                createDetails.index = current;
              }
              const newNode = await chromeP.bookmarksCreate(createDetails);
              itemMap[raindropId] = newNode.id;
              didChange = true;
            }
          }
        } catch (e) {
          // Best-effort recovery: ensure folder and try once more
          if (isUnsorted) {
            try {
              targetFolderId = await ensureUnsortedFolder(collectionMap);
              const createDetails = {
                parentId: targetFolderId,
                title: item.title || '',
                url: item.link || item.url || '',
              };
              if (!isInitial) {
                const current = folderInsertionCount.get(targetFolderId) || 0;
                folderInsertionCount.set(targetFolderId, current + 1);
                createDetails.index = current;
              }
              const newNode = await chromeP.bookmarksCreate(createDetails);
              itemMap[raindropId] = newNode.id;
              didChange = true;
            } catch (_) {}
          }
        }
      } else {
        if (!shouldSkipCreate && targetFolderId) {
          try {
            const createDetails = {
              parentId: targetFolderId,
              title: item.title || '',
              url: item.link || item.url || '',
            };
            if (!isInitial) {
              const current = folderInsertionCount.get(targetFolderId) || 0;
              folderInsertionCount.set(targetFolderId, current + 1);
              createDetails.index = current;
            }
            const newNode = await chromeP.bookmarksCreate(createDetails);
            itemMap[raindropId] = newNode.id;
            didChange = true;
          } catch (e) {
            // Only retry for Unsorted
            if (isUnsorted) {
              try {
                targetFolderId = await ensureUnsortedFolder(collectionMap);
                const createDetails = {
                  parentId: targetFolderId,
                  title: item.title || '',
                  url: item.link || item.url || '',
                };
                if (!isInitial) {
                  const current = folderInsertionCount.get(targetFolderId) || 0;
                  folderInsertionCount.set(targetFolderId, current + 1);
                  createDetails.index = current;
                }
                const newNode = await chromeP.bookmarksCreate(createDetails);
                itemMap[raindropId] = newNode.id;
                didChange = true;
              } catch (_) {}
            }
          }
        }
      }

      if (itemLast > maxLastUpdate) maxLastUpdate = itemLast;
    }

    if (stop || items.length < 50) break;
    page += 1;
  }

  return { itemMap, newLastSyncISO: maxLastUpdate.toISOString(), didChange };
}

/**
 * Ensures that a local "Unsorted" folder exists and is mapped to collection id -1.
 *
 * @param {Record<string,string>} collectionMap - Map of collectionId → Chrome folder id (mutated and saved).
 * @returns {Promise<string>} The folder id for the Unsorted collection.
 */
async function ensureUnsortedFolder(collectionMap) {
  // Ensure an "Unsorted" folder mapping under root for collection -1
  const rootFolderId = await getOrCreateRootFolder();
  if (collectionMap[String(UNSORTED_COLLECTION_ID)])
    return collectionMap[String(UNSORTED_COLLECTION_ID)];
  const folderId = await getOrCreateChildFolder(rootFolderId, 'Unsorted');
  collectionMap[String(UNSORTED_COLLECTION_ID)] = folderId;
  await saveState({ collectionMap });
  return folderId;
}

/**
 * Removes local Chrome bookmarks corresponding to items moved to Trash since `lastSyncISO`.
 *
 * Queries `/raindrops/-99` and deletes corresponding bookmarks; also performs
 * best-effort cleanup by URL if a direct mapping is missing.
 *
 * @param {(string|null)} lastSyncISO - ISO timestamp of the last successful sync.
 * @param {Record<string,string>} itemMap - Map of raindrop _id → Chrome bookmark id (mutated).
 * @param {Record<string,string>} collectionMap - Map of collectionId → Chrome folder id.
 * @returns {Promise<{ itemMap: Record<string,string>, didChange: boolean }>} Updated item map after deletions and whether any local bookmarks were removed.
 */
async function syncDeletedItems(lastSyncISO, itemMap, collectionMap) {
  let page = 0;
  let stop = false;
  let didChange = false;

  while (!stop) {
    const res = await apiGET(
      `/raindrops/-99?sort=-lastUpdate&perpage=50&page=${page}`,
    );
    const items = Array.isArray(res.items) ? res.items : [];
    for (const item of items) {
      const itemLast = new Date(item.lastUpdate || item.lastupdate || 0);
      if (lastSyncISO && itemLast <= new Date(lastSyncISO)) {
        stop = true;
        break;
      }
      const raindropId = String(item._id);
      const localId = itemMap[raindropId];
      if (localId) {
        try {
          await chromeP.bookmarksRemove(localId);
        } catch (_) {}
        delete itemMap[raindropId];
        didChange = true;
      } else {
        // Optional: best-effort cleanup by URL in expected folder
        const collectionId = extractCollectionId(item);
        const folderId = collectionMap[String(collectionId)];
        if (folderId) {
          try {
            const children = await chromeP.bookmarksGetChildren(folderId);
            const found = children.find(
              (c) => c.url && c.url === (item.link || item.url),
            );
            if (found) {
              await chromeP.bookmarksRemove(found.id);
              didChange = true;
            }
          } catch (_) {}
        }
      }
    }
    if (stop || items.length < 50) break;
    page += 1;
  }

  return { itemMap, didChange };
}

/**
 * Ensures the Raindrop root folder exists; if it was deleted/missing, reset state and treat as initial sync.
 *
 * When missing:
 * - Finds or recreates the `ROOT_FOLDER_NAME` under Bookmarks Bar
 * - Clears lastSync, collectionMap, groupMap, itemMap
 * - Persists the new rootFolderId
 *
 * @param {{
 *   lastSync: (string|null),
 *   collectionMap: Record<string,string>,
 *   groupMap: Record<string,string>,
 *   itemMap: Record<string,string>,
 *   rootFolderId: (string|null)
 * }} state
 * @returns {Promise<{ didReset: boolean, rootFolderId: string, state: any }>} Result and updated state
 */
async function ensureRootAndMaybeReset(state) {
  let rootExists = false;
  let existingRootId = state && state.rootFolderId;
  if (existingRootId) {
    try {
      const nodes = await chromeP.bookmarksGet(existingRootId);
      if (nodes && nodes.length) rootExists = true;
    } catch (_) {
      rootExists = false;
    }
  }

  if (rootExists) {
    return { didReset: false, rootFolderId: String(existingRootId), state };
  }

  // Try to find folder by name under Bookmarks Bar; else create
  const barId = await getBookmarksBarFolderId();
  let newRootId = null;
  try {
    const children = await chromeP.bookmarksGetChildren(barId);
    const existing = children.find(
      (c) => c && !c.url && (c.title || '') === ROOT_FOLDER_NAME,
    );
    if (existing) {
      newRootId = existing.id;
    }
  } catch (_) {}
  if (!newRootId) {
    const node = await chromeP.bookmarksCreate({
      parentId: barId,
      title: ROOT_FOLDER_NAME,
    });
    newRootId = node.id;
  }

  const clearedState = {
    lastSync: null,
    collectionMap: {},
    groupMap: {},
    itemMap: {},
    rootFolderId: newRootId,
  };
  await saveState(clearedState);
  return { didReset: true, rootFolderId: newRootId, state: clearedState };
}

// ===== Helpers for bi-directional sync =====
function invertRecord(record) {
  const inverted = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (v != null) inverted[String(v)] = String(k);
  }
  return inverted; // value -> key
}

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
  return ids; // from node up to root
}

async function isUnderManagedRoot(nodeId, rootFolderId) {
  if (!nodeId || !rootFolderId) return false;
  const ancestors = await getAncestorIds(nodeId);
  return ancestors.includes(String(rootFolderId));
}

async function resolveParentCollectionId(parentFolderId, state) {
  const collectionMap = state.collectionMap || {};
  const groupMap = state.groupMap || {};
  const collectionByFolder = invertRecord(collectionMap); // chromeFolderId -> raindropCollectionId
  const unsortedFolderId = collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
  // Parent is a collection folder → return its collection id
  const mapped = collectionByFolder[String(parentFolderId)];
  if (mapped != null && mapped !== '') return Number(mapped);
  // Parent is Unsorted → treat as root/no parent for folders, -1 for items (handled by caller)
  if (String(parentFolderId) === String(unsortedFolderId)) return null;
  // Parent is a group folder or the root folder → root collection (no parent)
  for (const id of Object.values(groupMap || {})) {
    if (String(id) === String(parentFolderId)) return null;
  }
  if (String(parentFolderId) === String(state.rootFolderId || '')) return null;
  return null;
}

// ===== Local → Raindrop event mirroring =====
chrome.bookmarks?.onCreated.addListener(async (id, node) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    const state = await loadState();
    const rootFolderId = state.rootFolderId;
    if (!rootFolderId) return;
    // Only mirror changes under our managed root tree
    const underRoot = await isUnderManagedRoot(node.parentId, rootFolderId);
    if (!underRoot) return;

    const collectionMap = { ...(state.collectionMap || {}) };
    const collectionByFolder = invertRecord(collectionMap);
    const unsortedFolderId =
      collectionMap[String(UNSORTED_COLLECTION_ID)] || '';

    if (node.url) {
      // Bookmark created → create raindrop
      let collectionId = null;
      if (String(node.parentId) === String(unsortedFolderId)) {
        collectionId = UNSORTED_COLLECTION_ID;
      } else {
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
      // Folder created → create raindrop collection
      const parentCollectionId = await resolveParentCollectionId(
        node.parentId,
        state,
      );
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

chrome.bookmarks?.onRemoved.addListener(async (id, removeInfo) => {
  try {
    if (isSyncing || suppressLocalBookmarkEvents) return;
    const state = await loadState();
    // If our managed root folder is missing, skip mirroring deletions (likely user removed the whole tree)
    if (state.rootFolderId) {
      try {
        const nodes = await chromeP.bookmarksGet(String(state.rootFolderId));
        if (!nodes || nodes.length === 0) return; // root missing → do not propagate deletions to cloud
      } catch (_) {
        return;
      }
    }
    const itemMap = { ...(state.itemMap || {}) };
    const collectionMap = { ...(state.collectionMap || {}) };
    const itemByLocal = invertRecord(itemMap); // chromeId -> raindropId
    const collectionByLocal = invertRecord(collectionMap); // folderId -> collectionId

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
    // Only mirror if moved within our managed root tree
    const underRoot = await isUnderManagedRoot(moveInfo.parentId, rootFolderId);
    if (!underRoot) return;

    const itemMap = { ...(state.itemMap || {}) };
    const collectionMap = { ...(state.collectionMap || {}) };
    const groupMap = { ...(state.groupMap || {}) };
    const itemByLocal = invertRecord(itemMap);
    const collectionByLocal = invertRecord(collectionMap);
    const unsortedFolderId =
      collectionMap[String(UNSORTED_COLLECTION_ID)] || '';

    if (itemByLocal[String(id)]) {
      // Bookmark moved → update item's collection
      const raindropId = itemByLocal[String(id)];
      let newCollectionId = null;
      if (String(moveInfo.parentId) === String(unsortedFolderId)) {
        newCollectionId = UNSORTED_COLLECTION_ID;
      } else {
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
      // Folder moved → update collection parent
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
      ) {
        parentCollectionId = null; // move to root
      } else {
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

// ===== Core Sync =====
/**
 * Orchestrates a full sync run:
 * - Loads state
 * - Fetches groups/collections
 * - Syncs folders
 * - Syncs new/updated items
 * - Syncs deletions
 * - Persists state
 *
 * Concurrency is guarded by `isSyncing`.
 * @returns {Promise<void>}
 */
async function performTabsSync() {
  const { enabled, groupTitle } = await loadTabsConfig();
  if (!enabled) {
    return;
  }

  try {
    // This is a placeholder for the full implementation.
    // The real implementation will be built in subsequent steps.
    console.log(`Starting tabs sync for group: "${groupTitle}"`);
    const cloudModel = await fetchTabsCloudModel(groupTitle);
    await applyCloudToBrowser(cloudModel);
    const browserModel = await readBrowserModel();
    // For now, we are not mirroring back to the cloud, just logging.
    console.log('Browser model:', browserModel);
  } catch (err) {
    console.error('Tab sync failed:', err);
    // Optionally notify user of tab sync failure
  }
}

async function performSync() {
  if (isSyncing) return;
  isSyncing = true;
  suppressLocalBookmarkEvents = true;
  // Read user preference (default ON)
  let notifyPref = true;
  try {
    const data = await chromeP.storageGet('notifyOnSync');
    if (data && typeof data.notifyOnSync === 'boolean') {
      notifyPref = data.notifyOnSync;
    }
  } catch (_) {}

  let didSucceed = false;
  let hasAnyChanges = false;
  // Show action badge during sync
  setBadge('Sync', '#38bdf8'); // Tailwind sky-400
  try {
    let state = await loadState();
    // If root folder missing (deleted by user), reset and treat as initial sync
    const { didReset, state: updatedState } = await ensureRootAndMaybeReset(
      state,
    );
    if (didReset) {
      state = updatedState;
    }

    // 1) Fetch groups and collections
    const { groups, rootCollections, childCollections } =
      await fetchGroupsAndCollections();

    // Exclude the tabs sync group from bookmark processing
    const { groupTitle: tabsGroupTitle } = await loadTabsConfig();
    const bookmarkGroups = groups.filter(g => g.title !== tabsGroupTitle);

    const collectionsById = buildCollectionsIndex(
      rootCollections,
      childCollections,
    );

    // 2) Sync folders (groups + collections)
    const { collectionMap, didChange: foldersChanged } = await syncFolders(
      bookmarkGroups,
      collectionsById,
      state,
    );

    // 3) Sync new/updated items
    const {
      itemMap: updatedItemMap,
      newLastSyncISO,
      didChange: itemsChanged,
    } = await syncNewAndUpdatedItems(state.lastSync, collectionMap, {
      ...(state.itemMap || {}),
    });

    // 4) Sync deleted items (trash)
    const { itemMap: prunedItemMap, didChange: deletionsChanged } =
      await syncDeletedItems(state.lastSync, updatedItemMap, collectionMap);

    hasAnyChanges = Boolean(foldersChanged || itemsChanged || deletionsChanged);

    // 5) Persist state for bookmarks
    await saveState({
      lastSync: newLastSyncISO,
      collectionMap,
      itemMap: prunedItemMap,
    });

    // 6) Perform Tabs Sync
    await performTabsSync();

    didSucceed = true;
  } catch (err) {
    // Log but do not throw; next alarm will retry
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
    suppressLocalBookmarkEvents = false;
    isSyncing = false;
    // Force refresh of badge text to avoid stale "Sync" lingering in some cases
    try {
      clearBadge();
    } catch (_) {}
    if (didSucceed) {
      // Success badge
      setBadge('Done', '#22c55e'); // Tailwind green-500
      scheduleClearBadge(3000);
    } else {
      // Failure badge
      setBadge('Error', '#ef4444'); // Tailwind red-500
      scheduleClearBadge(3000);
    }
    if (didSucceed && notifyPref && hasAnyChanges) {
      try {
        notifySyncSuccess('Sync completed successfully.');
      } catch (_) {}
    }
  }
}

// ===== Alarms and Lifecycle =====
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
  } catch (_) {}
  // Cleanup legacy folders created by previous versions
  try {
    await removeLegacyTopFolders();
  } catch (_) {}
  // Reflect current configured actions in tooltip
  try {
    await updateActionTitle();
  } catch (_) {}

  if (details && details.reason === 'install') {
    // If a token already exists (e.g., synced profile), kick off a sync immediately
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      const token = (
        data && data.raindropApiToken ? String(data.raindropApiToken) : ''
      ).trim();
      if (token) {
        RAINDROP_API_TOKEN = token;
        performSync();
      } else {
        // Open Options page on first install
        try {
          chrome.runtime.openOptionsPage();
        } catch (_) {}
      }
    } catch (_) {}
  }
});

chrome.runtime.onStartup?.addListener(() => {
  try {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
  } catch (_) {}
  // Update tooltip on browser startup
  try {
    updateActionTitle();
  } catch (_) {}
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) {
    // Note: async function keeps service worker alive until completion
    performSync();
  } else if (alarm && alarm.name === 'raindrop-clear-badge') {
    clearBadge();
  }
});

// Optional: manual trigger via action click for testing
// ===== Action button single vs double-click handling =====
const DOUBLE_CLICK_MS = 350;
let lastActionClickTs = 0;
let actionClickTimerId = null;

async function getActionPreferences() {
  try {
    const data = await chromeP.storageGet([
      'actionSingle',
      'actionDouble',
      'actionBehavior', // legacy single-click key
    ]);
    const single =
      (data && data.actionSingle) || (data && data.actionBehavior) || 'sync';
    const double = (data && data.actionDouble) || 'save';
    return { single, double };
  } catch (_) {
    return { single: 'sync', double: 'save' };
  }
}

async function performActionBehavior(behavior) {
  try {
    if (behavior === 'none') return;
    if (behavior === 'options') {
      try {
        chrome.runtime.openOptionsPage();
      } catch (_) {}
      return;
    }
    if (behavior === 'save') {
      await saveCurrentOrHighlightedTabsToRaindrop();
      return;
    }
    // default: sync
    await performSync();
  } catch (_) {
    try {
      await performSync();
    } catch (_) {}
  }
}

function behaviorLabel(behavior) {
  switch (behavior) {
    case 'sync':
      return 'Sync';
    case 'save':
      return 'Save to Raindrop';
    case 'options':
      return 'Open Options';
    case 'none':
      return 'Do nothing';
    default:
      return 'Sync';
  }
}

async function updateActionTitle() {
  try {
    const { single, double } = await getActionPreferences();
    const title = `Click: ${behaviorLabel(
      single,
    )}; Double-click: ${behaviorLabel(double)}`;
    try {
      chrome.action?.setTitle({ title });
    } catch (_) {}
  } catch (_) {}
}

chrome.action?.onClicked.addListener(async () => {
  const now = Date.now();
  // Second click within threshold → double-click
  if (lastActionClickTs && now - lastActionClickTs <= DOUBLE_CLICK_MS) {
    lastActionClickTs = 0;
    if (actionClickTimerId) {
      try {
        clearTimeout(actionClickTimerId);
      } catch (_) {}
      actionClickTimerId = null;
    }
    const { double } = await getActionPreferences();
    await performActionBehavior(double);
    return;
  }

  // First click → set timer; if no second click arrives, treat as single-click
  lastActionClickTs = now;
  if (actionClickTimerId) {
    try {
      clearTimeout(actionClickTimerId);
    } catch (_) {}
  }
  actionClickTimerId = setTimeout(async () => {
    lastActionClickTs = 0;
    actionClickTimerId = null;
    const { single } = await getActionPreferences();
    await performActionBehavior(single);
  }, DOUBLE_CLICK_MS + 10);
});

/**
 * Saves the current active tab or highlighted tabs to Raindrop Unsorted collection
 * and creates local bookmarks at the top of the local Unsorted folder.
 */
async function saveCurrentOrHighlightedTabsToRaindrop() {
  // Show badge
  setBadge('Saving', '#f59e0b'); // amber-500
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

    // Ensure we have collection mapping and local Unsorted folder id
    const state = await loadState();
    const collectionMap = { ...(state.collectionMap || {}) };
    const unsortedFolderId = await ensureUnsortedFolder(collectionMap);

    // POST many to Raindrop unsorted with pleaseParse
    await loadTokenIfNeeded();
    const body = {
      items: titlesAndUrls.map(({ title, url }) => ({
        link: url,
        title: title || url,
        collection: { $id: UNSORTED_COLLECTION_ID },
        pleaseParse: {},
      })),
    };
    const res = await raindropPOST('raindrops', body);
    const createdItems = res && Array.isArray(res.items) ? res.items : [];
    const successCount = createdItems.length;

    // Create local bookmarks at top of Unsorted for the source URLs (avoid empty folders)
    // Map Raindrop ids by link so we can persist itemMap
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
    // Merge mappings so future sync recognizes these new items
    const mergedItemMap = { ...((state && state.itemMap) || {}) };
    suppressLocalBookmarkEvents = true;
    try {
      for (const { id, title, url } of toCreateLocally.slice().reverse()) {
        try {
          const node = await chromeP.bookmarksCreate({
            parentId: unsortedFolderId,
            title: title || url,
            url,
            index: 0,
          });
          if (id) mergedItemMap[id] = node.id;
        } catch (_) {}
      }
    } finally {
      suppressLocalBookmarkEvents = false;
    }
    try {
      await saveState({ itemMap: mergedItemMap });
    } catch (_) {}

    if (successCount > 0) {
      setBadge('Saved', '#22c55e'); // green-500
      scheduleClearBadge(3000);
      try {
        notify(
          `Saved ${successCount} page${
            successCount > 1 ? 's' : ''
          } to Raindrop`,
        );
      } catch (_) {}
    } else {
      setBadge('Error', '#ef4444');
      scheduleClearBadge(3000);
      try {
        notify('Failed to save tab(s) to Raindrop');
      } catch (_) {}
    }
  } catch (err) {
    setBadge('Error', '#ef4444');
    scheduleClearBadge(3000);
    try {
      notify('Failed to save tab(s) to Raindrop');
    } catch (_) {}
  }
}

// Listen for storage changes to update token immediately
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes && changes.raindropApiToken) {
    const newToken = (changes.raindropApiToken.newValue || '').trim();
    const oldToken = (changes.raindropApiToken.oldValue || '').trim();
    RAINDROP_API_TOKEN = newToken;
    if (newToken && newToken !== oldToken) {
      // Token provided/updated → attempt immediate sync
      try {
        performSync();
      } catch (_) {}
    }
  }
  if (
    area === 'local' &&
    changes &&
    (changes.actionSingle || changes.actionDouble || changes.actionBehavior)
  ) {
    try {
      updateActionTitle();
    } catch (_) {}
  }
});

// Open Options when user clicks token notification
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

// ===== Tab Sync Event Mirroring (Browser → Cloud) =====
// Note: These listeners call a placeholder function for now.
// The actual implementation will be in `tabsSync.js`.

chrome.windows?.onCreated.addListener((window) => {
  mirrorBrowserToCloud({ event: 'window.onCreated', window });
});

chrome.tabs?.onCreated.addListener((tab) => {
  mirrorBrowserToCloud({ event: 'tab.onCreated', tab });
});

chrome.tabs?.onRemoved.addListener((tabId, removeInfo) => {
  mirrorBrowserToCloud({ event: 'tab.onRemoved', tabId, removeInfo });
});

chrome.tabs?.onUpdated.addListener((tabId, changeInfo, tab) => {
  mirrorBrowserToCloud({ event: 'tab.onUpdated', tabId, changeInfo, tab });
});

chrome.tabs?.onMoved.addListener((tabId, moveInfo) => {
  mirrorBrowserToCloud({ event: 'tab.onMoved', tabId, moveInfo });
});

chrome.tabs?.onAttached.addListener((tabId, attachInfo) => {
  mirrorBrowserToCloud({ event: 'tab.onAttached', tabId, attachInfo });
});

chrome.tabs?.onDetached.addListener((tabId, detachInfo) => {
  mirrorBrowserToCloud({ event: 'tab.onDetached', tabId, detachInfo });
});

chrome.tabGroups?.onCreated.addListener((group) => {
  mirrorBrowserToCloud({ event: 'tabGroup.onCreated', group });
});

chrome.tabGroups?.onRemoved.addListener((group) => {
  mirrorBrowserToCloud({ event: 'tabGroup.onRemoved', group });
});

chrome.tabGroups?.onUpdated.addListener((group) => {
  mirrorBrowserToCloud({ event: 'tabGroup.onUpdated', group });
});

chrome.tabGroups?.onMoved.addListener((group) => {
  mirrorBrowserToCloud({ event: 'tabGroup.onMoved', group });
});
