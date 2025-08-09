// Raindrop Sync Background Service Worker (Manifest V3)
// Periodically sync Raindrop.io collections and bookmarks into Chrome bookmarks

// ===== Configuration =====
const RAINDROP_API_BASE = 'https://api.raindrop.io/rest/v1';
// API token is loaded from storage (set via Options page)
let RAINDROP_API_TOKEN = '';
const TOKEN_NOTIFICATION_ID = 'raindrop-token-required';
let lastTokenNotificationMs = 0;

const ALARM_NAME = 'raindrop-sync';
const SYNC_PERIOD_MINUTES = 10;

const STORAGE_KEYS = {
  lastSync: 'lastSync',
  collectionMap: 'collectionMap', // { [collectionId: string]: chromeFolderId: string }
  groupMap: 'groupMap', // { [groupTitle: string]: chromeFolderId: string }
  itemMap: 'itemMap', // { [raindropItemId: string]: chromeBookmarkId: string }
  rootFolderId: 'rootFolderId', // chrome folder id for the Raindrop root
};

const ROOT_FOLDER_NAME = 'Raindrop Bookmarks';
const UNSORTED_COLLECTION_ID = -1; // Raindrop special collection id

// Concurrency guard (service worker scope)
let isSyncing = false;

// ===== Utility: Promisified Chrome APIs =====
/**
 * Promisified Chrome extension APIs for storage and bookmarks.
 */
const chromeP = {
  /**
   * Get values from chrome.storage.local.
   * @param {string|string[]} keys - A string or array of strings specifying keys to get.
   * @returns {Promise<Object>} Resolves with the retrieved values.
   */
  storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },

  /**
   * Set values in chrome.storage.local.
   * @param {Object} values - An object which gives each key/value pair to update storage with.
   * @returns {Promise<void>} Resolves when the values are set.
   */
  storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  },

  /**
   * Create a new bookmark or folder.
   * @param {chrome.bookmarks.CreateDetails} details - Details about the bookmark or folder to create.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the created bookmark node.
   */
  bookmarksCreate(details) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.create(details, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Update a bookmark or folder.
   * @param {string} id - The ID of the bookmark or folder to update.
   * @param {Object} changes - The changes to apply.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the updated bookmark node.
   */
  bookmarksUpdate(id, changes) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.update(id, changes, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Move a bookmark or folder to a new location.
   * @param {string} id - The ID of the bookmark or folder to move.
   * @param {Object} destination - The destination information.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the moved bookmark node.
   */
  bookmarksMove(id, destination) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.move(id, destination, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Remove a bookmark or empty folder.
   * @param {string} id - The ID of the bookmark or folder to remove.
   * @returns {Promise<void>} Resolves when the bookmark or folder is removed.
   */
  bookmarksRemove(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.remove(id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }),
    );
  },

  /**
   * Remove a bookmark folder and all its contents recursively.
   * @param {string} id - The ID of the folder to remove.
   * @returns {Promise<void>} Resolves when the folder and all its contents are removed.
   */
  bookmarksRemoveTree(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.removeTree(id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }),
    );
  },

  /**
   * Retrieve a bookmark or folder by ID.
   * @param {string} id - The ID of the bookmark or folder to retrieve.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with an array of bookmark nodes.
   */
  bookmarksGet(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.get(id, (nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },

  /**
   * Retrieve the children of a bookmark folder.
   * @param {string} id - The ID of the folder.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with an array of child bookmark nodes.
   */
  bookmarksGetChildren(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.getChildren(id, (nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },

  /**
   * Retrieve the entire bookmarks tree.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with the root nodes of the bookmarks tree.
   */
  bookmarksGetTree() {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },
};

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
  const url = `${RAINDROP_API_BASE}${
    pathWithQuery.startsWith('/') ? '' : '/'
  }${pathWithQuery}`;
  if (!RAINDROP_API_TOKEN) {
    // Load token lazily from storage
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
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    const text = await res.text().catch(() => '');
    throw new Error(
      `Raindrop API error ${res.status} for ${pathWithQuery}: ${text}`,
    );
  }
  return res.json();
}

/**
 * Show a notification prompting the user to configure their Raindrop API token.
 * Clicking the notification opens the extension Options page.
 * Debounced to avoid spamming.
 * @param {string} message
 */
function notifyMissingOrInvalidToken(message) {
  const now = Date.now();
  if (now - lastTokenNotificationMs < 60000) return; // debounce 60s
  lastTokenNotificationMs = now;
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      TOKEN_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Sync: Action required',
        message:
          message || 'Please configure your Raindrop API token in Options.',
        priority: 2,
        requireInteraction: true,
      },
      () => {},
    );
  } catch (_) {}
}

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
async function getBookmarksBarFolderId() {
  // Chrome commonly uses id '1' for Bookmarks Bar, but do not assume
  const tree = await chromeP.bookmarksGetTree();
  const root = tree && tree[0];
  if (!root || !root.children) return '1';
  const bar = root.children.find(
    (n) =>
      n.id === '1' ||
      (n.title || '').toLowerCase().includes('bookmarks bar') ||
      (n.title || '').toLowerCase().includes('bookmarks'),
  );
  return bar ? bar.id : '1';
}

/**
 * Gets the id of the extension's root folder ("Raindrop Bookmarks"),
 * creating it under "Bookmarks Bar" if it does not exist.
 *
 * The id is persisted in storage and validated on each call.
 *
 * @returns {Promise<string>} The Chrome bookmarks folder id for the root.
 */
async function getOrCreateRootFolder() {
  const state = await loadState();
  if (state.rootFolderId) {
    // Verify it still exists
    try {
      const nodes = await chromeP.bookmarksGet(state.rootFolderId);
      if (nodes && nodes.length) return state.rootFolderId;
    } catch (_) {
      // fallthrough to recreate
    }
  }

  const barId = await getBookmarksBarFolderId();
  const children = await chromeP.bookmarksGetChildren(barId);
  const existing = children.find((c) => c.title === ROOT_FOLDER_NAME && !c.url);
  if (existing) {
    await saveState({ rootFolderId: existing.id });
    return existing.id;
  }

  const node = await chromeP.bookmarksCreate({
    parentId: barId,
    title: ROOT_FOLDER_NAME,
  });
  await saveState({ rootFolderId: node.id });
  return node.id;
}

/**
 * Retrieves the ID of a child folder with the specified title under the given parent folder.
 * If such a folder does not exist, it creates one and returns its ID.
 *
 * @param {string} parentId - The ID of the parent bookmark folder.
 * @param {string} title - The title of the child folder to find or create.
 * @returns {Promise<string>} The ID of the found or newly created child folder.
 */
async function getOrCreateChildFolder(parentId, title) {
  const children = await chromeP.bookmarksGetChildren(parentId);
  const found = children.find((c) => !c.url && c.title === title);
  if (found) return found.id;
  const node = await chromeP.bookmarksCreate({ parentId, title });
  return node.id;
}

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
 * @returns {Promise<{rootFolderId: string, groupMap: Record<string,string>, collectionMap: Record<string,string>}>}
 *   Updated folder ids and maps.
 */
async function syncFolders(groups, collectionsById, state) {
  const rootFolderId = await getOrCreateRootFolder();
  const groupMap = { ...(state.groupMap || {}) };
  const collectionMap = { ...(state.collectionMap || {}) };

  // Ensure group folders
  const currentGroupTitles = new Set();

  // Ensure special Unsorted folder exists before all groups and map it to -1
  try {
    const unsortedId = await getOrCreateChildFolder(rootFolderId, 'Unsorted');
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
          }
          if (node.parentId !== parentFolderId) {
            await chromeP.bookmarksMove(existingFolderId, {
              parentId: parentFolderId,
            });
          }
        } else {
          // recreate
          const newNodeId = await getOrCreateChildFolder(
            parentFolderId,
            desiredTitle,
          );
          collectionMap[String(id)] = newNodeId;
        }
      } catch (_) {
        const newNodeId = await getOrCreateChildFolder(
          parentFolderId,
          desiredTitle,
        );
        collectionMap[String(id)] = newNodeId;
      }
    } else {
      const newNodeId = await getOrCreateChildFolder(
        parentFolderId,
        desiredTitle,
      );
      collectionMap[String(id)] = newNodeId;
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
    }
  }

  await saveState({ groupMap, collectionMap, rootFolderId });
  return { rootFolderId, groupMap, collectionMap };
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
 * @returns {Promise<{ itemMap: Record<string,string>, newLastSyncISO: string }>} Updated map and new high-water mark.
 */
async function syncNewAndUpdatedItems(lastSyncISO, collectionMap, itemMap) {
  let maxLastUpdate = lastSyncISO ? new Date(lastSyncISO) : new Date(0);
  let page = 0;
  let stop = false;
  const isInitial = !lastSyncISO;
  const folderInsertionCount = new Map(); // Map<string, number>

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
            }
            // Reposition to maintain lastUpdate DESC ordering
            if (!shouldSkipCreate && targetFolderId) {
              if (isInitial) {
                // Initial sync: append to end if folder changed
                if (node.parentId !== targetFolderId) {
                  await chromeP.bookmarksMove(localId, {
                    parentId: targetFolderId,
                  });
                }
              } else {
                // Incremental: insert at current head slot for this folder
                const current = folderInsertionCount.get(targetFolderId) || 0;
                folderInsertionCount.set(targetFolderId, current + 1);
                await chromeP.bookmarksMove(localId, {
                  parentId: targetFolderId,
                  index: current,
                });
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

  return { itemMap, newLastSyncISO: maxLastUpdate.toISOString() };
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
 * @returns {Promise<{ itemMap: Record<string,string> }>} Updated item map after deletions.
 */
async function syncDeletedItems(lastSyncISO, itemMap, collectionMap) {
  let page = 0;
  let stop = false;

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
            if (found) await chromeP.bookmarksRemove(found.id);
          } catch (_) {}
        }
      }
    }
    if (stop || items.length < 50) break;
    page += 1;
  }

  return { itemMap };
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
async function performSync() {
  if (isSyncing) return;
  isSyncing = true;
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
    const collectionsById = buildCollectionsIndex(
      rootCollections,
      childCollections,
    );

    // 2) Sync folders (groups + collections)
    const { collectionMap } = await syncFolders(groups, collectionsById, state);

    // 3) Sync new/updated items
    const { itemMap: updatedItemMap, newLastSyncISO } =
      await syncNewAndUpdatedItems(state.lastSync, collectionMap, {
        ...(state.itemMap || {}),
      });

    // 4) Sync deleted items (trash)
    const { itemMap: prunedItemMap } = await syncDeletedItems(
      state.lastSync,
      updatedItemMap,
      collectionMap,
    );

    // 5) Persist state
    await saveState({
      lastSync: newLastSyncISO,
      collectionMap,
      itemMap: prunedItemMap,
    });
  } catch (err) {
    // Log but do not throw; next alarm will retry
    console.error(
      'Raindrop sync failed:',
      err && err.message ? err.message : err,
    );
  } finally {
    isSyncing = false;
  }
}

// // ===== Alarms and Lifecycle =====
// chrome.runtime.onInstalled.addListener(async () => {
//   try {
//     chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
//   } catch (_) {}
//   // Optionally run an initial sync shortly after install
//   setTimeout(() => {
//     performSync();
//   }, 5000);
// });

// chrome.runtime.onStartup?.addListener(() => {
//   try {
//     chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
//   } catch (_) {}
// });

// chrome.alarms.onAlarm.addListener((alarm) => {
//   if (alarm && alarm.name === ALARM_NAME) {
//     // Note: async function keeps service worker alive until completion
//     performSync();
//   }
// });

// Optional: manual trigger via action click for testing
chrome.action?.onClicked.addListener(() => {
  performSync();
});

// Listen for storage changes to update token immediately
chrome.storage?.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes && changes.raindropApiToken) {
    RAINDROP_API_TOKEN = changes.raindropApiToken.newValue || '';
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
  }
});
