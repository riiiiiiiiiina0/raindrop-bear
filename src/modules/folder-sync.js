// Ensure Chrome folders reflect Raindrop groups and collections
import { chromeP } from './chrome.js';
import {
  ROOT_FOLDER_NAME,
  UNSORTED_COLLECTION_ID,
  getOrCreateRootFolder as bmGetOrCreateRootFolder,
  getOrCreateChildFolder as bmGetOrCreateChildFolder,
} from './bookmarks.js';
import { loadState as loadStateFn, saveState as saveStateFn } from './state.js';
import {
  buildCollectionToGroupMap,
  computeGroupForCollection,
  computeRootCollectionId,
} from './collections.js';

export async function getOrCreateRootFolder() {
  return bmGetOrCreateRootFolder(loadStateFn, saveStateFn);
}

export const getOrCreateChildFolder = bmGetOrCreateChildFolder;

export async function syncFolders(groups, collectionsById, state) {
  const rootFolderId = await getOrCreateRootFolder();
  const groupMap = { ...(state.groupMap || {}) };
  const collectionMap = { ...(state.collectionMap || {}) };
  let didChange = false;
  const SAVED_PROJECTS_TITLE = 'Saved Projects';

  const currentGroupTitles = new Set();

  try {
    const prevUnsorted = collectionMap[String(UNSORTED_COLLECTION_ID)];
    const unsortedId = await getOrCreateChildFolder(rootFolderId, 'Unsorted');
    if (prevUnsorted !== unsortedId) didChange = true;
    await chromeP.bookmarksMove(unsortedId, {
      parentId: rootFolderId,
      index: 0,
    });
    collectionMap[String(UNSORTED_COLLECTION_ID)] = unsortedId;
  } catch (_) {}

  for (const g of groups || []) {
    const title = g.title || '';
    if (title === SAVED_PROJECTS_TITLE) continue;
    currentGroupTitles.add(title);
    const folderId = await getOrCreateChildFolder(rootFolderId, title);
    groupMap[title] = folderId;
  }

  for (const [title, folderId] of Object.entries(groupMap)) {
    if (!currentGroupTitles.has(title) || title === SAVED_PROJECTS_TITLE) {
      try {
        await chromeP.bookmarksRemoveTree(folderId);
      } catch (_) {}
      delete groupMap[title];
      didChange = true;
    }
  }

  const rootCollectionToGroupTitle = buildCollectionToGroupMap(groups || []);

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
      parentFolderId = groupMap[groupTitle] || rootFolderId;
    } else {
      const rootId = computeRootCollectionId(id, collectionsById);
      if (rootId == null) {
        const existingFolderIdForChild = collectionMap[String(id)];
        if (existingFolderIdForChild) {
          try {
            await chromeP.bookmarksRemoveTree(existingFolderIdForChild);
          } catch (_) {}
          delete collectionMap[String(id)];
        }
        continue;
      }
      const parentFolder = collectionMap[String(info.parentId)];
      if (!parentFolder) {
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

  try {
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

    const childrenByParent = new Map();
    for (const info of collectionsById.values()) {
      if (info && info.parentId != null) {
        if (!childrenByParent.has(info.parentId))
          childrenByParent.set(info.parentId, []);
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
          return sa - sb;
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

  const currentIdSet = new Set(
    Array.from(collectionsById.keys()).map((n) => String(n)),
  );
  for (const [colId, folderId] of Object.entries(collectionMap)) {
    if (String(colId) === String(UNSORTED_COLLECTION_ID)) continue;
    if (!currentIdSet.has(String(colId))) {
      try {
        await chromeP.bookmarksRemoveTree(folderId);
      } catch (_) {}
      delete collectionMap[colId];
      didChange = true;
    }
  }

  await saveStateFn({ groupMap, collectionMap, rootFolderId });
  return { rootFolderId, groupMap, collectionMap, didChange };
}
