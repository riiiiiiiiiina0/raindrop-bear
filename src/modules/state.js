import { chromeP } from './chrome.js';

export const STORAGE_KEYS = {
  lastSync: 'lastSync',
  collectionMap: 'collectionMap',
  groupMap: 'groupMap',
  itemMap: 'itemMap',
  rootFolderId: 'rootFolderId',
  parentFolderId: 'parentFolderId',
};

export async function loadState() {
  const data = await chromeP.storageGet([
    STORAGE_KEYS.lastSync,
    STORAGE_KEYS.collectionMap,
    STORAGE_KEYS.groupMap,
    STORAGE_KEYS.itemMap,
    STORAGE_KEYS.rootFolderId,
    STORAGE_KEYS.parentFolderId,
  ]);
  return {
    lastSync: data[STORAGE_KEYS.lastSync] || null,
    collectionMap: data[STORAGE_KEYS.collectionMap] || {},
    groupMap: data[STORAGE_KEYS.groupMap] || {},
    itemMap: data[STORAGE_KEYS.itemMap] || {},
    rootFolderId: data[STORAGE_KEYS.rootFolderId] || null,
    parentFolderId: data[STORAGE_KEYS.parentFolderId] || null,
  };
}

export async function saveState(partial) {
  const toSave = {};
  for (const [k, v] of Object.entries(partial || {})) {
    if (k in STORAGE_KEYS) {
      toSave[STORAGE_KEYS[k]] = v;
    } else {
      toSave[k] = v;
    }
  }
  await chromeP.storageSet(toSave);
}
