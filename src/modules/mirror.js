// Local Chrome bookmarks -> Raindrop mirroring handlers
import { invertRecord } from './utils.js';
import { UNSORTED_COLLECTION_ID } from './bookmarks.js';
import { apiPOST, apiPUT, apiDELETE } from './api-facade.js';
import { loadState, saveState } from './state.js';
import {
  recentlyCreatedRemoteUrls,
  suppressLocalBookmarkEvents,
} from './shared-state.js';

export async function onCreated(id, node) {
  const state = await loadState();
  const rootFolderId = state.rootFolderId;
  if (!rootFolderId) return;
  // Only mirror changes under our managed root tree
  const underRoot = await isUnderManagedRoot(node.parentId, rootFolderId);
  if (!underRoot) return;

  const collectionMap = { ...(state.collectionMap || {}) };
  const collectionByFolder = invertRecord(collectionMap);
  const unsortedFolderId = collectionMap[String(UNSORTED_COLLECTION_ID)] || '';

  if (node.url) {
    if (node && node.url && recentlyCreatedRemoteUrls.has(String(node.url)))
      return;
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
        (created._id != null ? String(created._id) : String(created.id || ''));
      if (colId) {
        const newCollectionMap = { ...(state.collectionMap || {}) };
        newCollectionMap[colId] = String(id);
        await saveState({ collectionMap: newCollectionMap });
      }
    } catch (_) {}
  }
}

export async function onRemoved(id) {
  const state = await loadState();
  if (state.rootFolderId) {
    try {
      const nodes = await chrome.bookmarks.get(String(state.rootFolderId));
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
}

export async function onChanged(id, changeInfo) {
  const state = await loadState();
  const itemMap = { ...(state.itemMap || {}) };
  const collectionMap = { ...(state.collectionMap || {}) };
  const itemByLocal = invertRecord(itemMap);
  const collectionByLocal = invertRecord(collectionMap);
  if (itemByLocal[String(id)]) {
    const raindropId = itemByLocal[String(id)];
    const body = {};
    if (typeof changeInfo.title === 'string') body['title'] = changeInfo.title;
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
}

export async function onMoved(id, moveInfo, resolveParentCollectionId) {
  const state = await loadState();
  const rootFolderId = state.rootFolderId;
  if (!rootFolderId) return;
  const underRoot = await isUnderManagedRoot(moveInfo.parentId, rootFolderId);
  if (!underRoot) return;
  const itemMap = { ...(state.itemMap || {}) };
  const collectionMap = { ...(state.collectionMap || {}) };
  const groupMap = { ...(state.groupMap || {}) };
  const itemByLocal = invertRecord(itemMap);
  const collectionByLocal = invertRecord(collectionMap);
  const unsortedFolderId = collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
  if (itemByLocal[String(id)]) {
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
      parentCollectionId = null;
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
}

// Helpers shared in background originally
export function invertRecord(record) {
  const inverted = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (v != null) inverted[String(v)] = String(k);
  }
  return inverted;
}

async function getAncestorIds(nodeId) {
  const ids = [];
  let currentId = nodeId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    ids.push(String(currentId));
    try {
      const nodes = await new Promise((resolve) =>
        chrome.bookmarks.get(String(currentId), (n) => resolve(n)),
      );
      const node = nodes && nodes[0];
      if (!node || !node.parentId) break;
      currentId = node.parentId;
    } catch (_) {
      break;
    }
  }
  return ids;
}

export async function isUnderManagedRoot(nodeId, rootFolderId) {
  if (!nodeId || !rootFolderId) return false;
  const ancestors = await getAncestorIds(nodeId);
  return ancestors.includes(String(rootFolderId));
}

export async function resolveParentCollectionId(parentFolderId, state) {
  const collectionMap = state.collectionMap || {};
  const groupMap = state.groupMap || {};
  const collectionByFolder = invertRecord(collectionMap);
  const unsortedFolderId = collectionMap[String(UNSORTED_COLLECTION_ID)] || '';
  const mapped = collectionByFolder[String(parentFolderId)];
  if (mapped != null && mapped !== '') return Number(mapped);
  if (String(parentFolderId) === String(unsortedFolderId)) return null;
  for (const id of Object.values(groupMap || {})) {
    if (String(id) === String(parentFolderId)) return null;
  }
  if (String(parentFolderId) === String(state.rootFolderId || '')) return null;
  return null;
}
