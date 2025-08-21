import { chromeP } from './chrome.js';
import { getBookmarksBarFolderId, ROOT_FOLDER_NAME } from './bookmarks.js';
import { saveState as saveStateFn } from './state.js';
import { getFoldersByTitle } from './collections.js';
import { isDescendant } from './utils.js';

export async function ensureRootAndMaybeReset(state) {
  const deletedFolderIds = await getFoldersByTitle('Deleted');
  if (state && state.rootFolderId) {
    try {
      const nodes = await chromeP.bookmarksGet(state.rootFolderId);
      if (
        nodes &&
        nodes.length > 0 &&
        !isDescendant(nodes[0].id, deletedFolderIds)
      ) {
        return {
          didReset: false,
          rootFolderId: String(state.rootFolderId),
          state,
        };
      }
    } catch (_) {}
  }

  const barId = await getBookmarksBarFolderId();
  let newRootId = null;
  try {
    const children = await chromeP.bookmarksGetChildren(barId);
    for (const c of children) {
      if (c && !c.url && (c.title || '') === ROOT_FOLDER_NAME) {
        if (!isDescendant(c.id, deletedFolderIds)) {
          newRootId = c.id;
          break;
        }
      }
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
    parentFolderId: barId,
  };
  await saveStateFn(clearedState);
  return { didReset: true, rootFolderId: newRootId, state: clearedState };
}
