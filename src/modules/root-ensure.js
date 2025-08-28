import { chromeP } from './chrome.js';
import { getBookmarksBarFolderId, ROOT_FOLDER_NAME } from './bookmarks.js';
import { saveState as saveStateFn } from './state.js';

export async function ensureRootAndMaybeReset(state) {
  let rootExists = false;
  const { rootFolderId, parentFolderId } = state || {};

  if (rootFolderId) {
    try {
      const nodes = await chromeP.bookmarksGet(String(rootFolderId));
      if (nodes?.length > 0) {
        rootExists = true;
      }
    } catch (_) {
      rootExists = false;
    }
  }

  if (rootExists) {
    return { didReset: false, rootFolderId: String(rootFolderId), state };
  }

  // If root doesn't exist, try to find it by name in the correct parent folder
  const parentId = parentFolderId || (await getBookmarksBarFolderId());
  let newRootId = null;

  try {
    const children = await chromeP.bookmarksGetChildren(String(parentId));
    const existing = children.find(
      (c) => c && !c.url && c.title === ROOT_FOLDER_NAME,
    );
    if (existing) {
      newRootId = existing.id;
    }
  } catch (error) {
    console.error(
      'Error searching for existing root folder, will create a new one.',
      error,
    );
  }

  // If still no root, create it
  if (!newRootId) {
    try {
      const node = await chromeP.bookmarksCreate({
        parentId: String(parentId),
        title: ROOT_FOLDER_NAME,
      });
      newRootId = node.id;
    } catch (error) {
      console.error(
        'Failed to create a new root folder. Sync cannot proceed.',
        error,
      );
      // If creation fails, we cannot proceed.
      return { didReset: false, rootFolderId: null, state };
    }
  }

  // Since we either found a new root or created one, state is stale. Reset it.
  const clearedState = {
    ...(state || {}),
    lastSync: null,
    collectionMap: {},
    groupMap: {},
    itemMap: {},
    rootFolderId: newRootId,
  };
  await saveStateFn(clearedState);

  return { didReset: true, rootFolderId: newRootId, state: clearedState };
}
