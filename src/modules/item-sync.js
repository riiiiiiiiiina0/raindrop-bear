import { apiGET, apiPOST } from './api-facade.js';
import { chromeP } from './chrome.js';
import { UNSORTED_COLLECTION_ID } from './bookmarks.js';
import { saveState as saveStateFn } from './state.js';

export function extractCollectionId(item) {
  if (item == null) return null;
  if (item.collection && item.collection.$id != null)
    return item.collection.$id;
  if (item.collectionId != null) return item.collectionId;
  if (item.collection && item.collection.id != null) return item.collection.id;
  return null;
}

export async function ensureUnsortedFolder(
  getOrCreateRootFolder,
  getOrCreateChildFolder,
  collectionMap,
) {
  const rootFolderId = await getOrCreateRootFolder();
  if (collectionMap[String(UNSORTED_COLLECTION_ID)])
    return collectionMap[String(UNSORTED_COLLECTION_ID)];
  const folderId = await getOrCreateChildFolder(rootFolderId, 'Unsorted');
  collectionMap[String(UNSORTED_COLLECTION_ID)] = folderId;
  await saveStateFn({ collectionMap });
  return folderId;
}

export async function syncNewAndUpdatedItems(
  lastSyncISO,
  collectionMap,
  itemMap,
  getOrCreateRootFolder,
  getOrCreateChildFolder,
) {
  let maxLastUpdate = lastSyncISO ? new Date(lastSyncISO) : new Date(0);
  let page = 0;
  let stop = false;
  const isInitial = !lastSyncISO;
  const folderInsertionCount = new Map();
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
        targetFolderId = await ensureUnsortedFolder(
          getOrCreateRootFolder,
          getOrCreateChildFolder,
          collectionMap,
        );
      } else {
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
            if (!shouldSkipCreate && targetFolderId) {
              if (isInitial) {
                if (node.parentId !== targetFolderId) {
                  await chromeP.bookmarksMove(localId, {
                    parentId: targetFolderId,
                  });
                  didChange = true;
                }
              } else {
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
          if (isUnsorted) {
            try {
              targetFolderId = await ensureUnsortedFolder(
                getOrCreateRootFolder,
                getOrCreateChildFolder,
                collectionMap,
              );
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
            const children = await chromeP.bookmarksGetChildren(targetFolderId);
            const url = item.link || item.url || '';
            const existing = children.find((c) => c.url === url);

            if (!existing) {
              const createDetails = {
                parentId: targetFolderId,
                title: item.title || '',
                url: url,
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
          } catch (e) {
            if (isUnsorted) {
              try {
                targetFolderId = await ensureUnsortedFolder(
                  getOrCreateRootFolder,
                  getOrCreateChildFolder,
                  collectionMap,
                );

                const children = await chromeP.bookmarksGetChildren(
                  targetFolderId,
                );
                const url = item.link || item.url || '';
                const existing = children.find((c) => c.url === url);

                if (!existing) {
                  const createDetails = {
                    parentId: targetFolderId,
                    title: item.title || '',
                    url: url,
                  };
                  if (!isInitial) {
                    const current =
                      folderInsertionCount.get(targetFolderId) || 0;
                    folderInsertionCount.set(targetFolderId, current + 1);
                    createDetails.index = current;
                  }
                  const newNode = await chromeP.bookmarksCreate(createDetails);
                  itemMap[raindropId] = newNode.id;
                  didChange = true;
                }
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

export async function syncDeletedItems(lastSyncISO, itemMap, collectionMap) {
  // Skip fetching trashed items on the initial sync
  if (!lastSyncISO) {
    return { itemMap, didChange: false };
  }
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
