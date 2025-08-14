import { chromeP } from './chrome.js';
import { getBookmarksBarFolderId, ROOT_FOLDER_NAME } from './bookmarks.js';
import { saveState as saveStateFn } from './state.js';

export async function ensureRootAndMaybeReset(state) {
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

  const barId = await getBookmarksBarFolderId();
  let newRootId = null;
  try {
    const children = await chromeP.bookmarksGetChildren(barId);
    const existing = children.find(
      (c) => c && !c.url && (c.title || '') === ROOT_FOLDER_NAME,
    );
    if (existing) newRootId = existing.id;
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
  await saveStateFn(clearedState);
  return { didReset: true, rootFolderId: newRootId, state: clearedState };
}
