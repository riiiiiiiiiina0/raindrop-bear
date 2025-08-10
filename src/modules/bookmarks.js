import { chromeP } from './chrome.js';

export const ROOT_FOLDER_NAME = 'Raindrop';
export const UNSORTED_COLLECTION_ID = -1;

/**
 * Gets the ID of the Chrome Bookmarks Bar folder.
 * Tries to find the bookmarks bar by id or by name, falling back to '1' if not found.
 *
 * @returns {Promise<string>} The ID of the bookmarks bar folder.
 */
export async function getBookmarksBarFolderId() {
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
 * Gets or creates the root folder for Raindrop bookmarks in the Chrome bookmarks bar.
 * Uses the provided loadState and saveState functions to persist the folder ID.
 *
 * @param {Function} loadState - Async function that loads the persisted state object.
 * @param {Function} saveState - Async function that saves state updates (object).
 * @returns {Promise<string>} The ID of the Raindrop root folder.
 */
export async function getOrCreateRootFolder(loadState, saveState) {
  const state = await loadState();
  if (state.rootFolderId) {
    try {
      const nodes = await chromeP.bookmarksGet(state.rootFolderId);
      if (nodes && nodes.length) return state.rootFolderId;
    } catch (_) {}
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
 * Gets or creates a child folder with the given title under the specified parent folder.
 *
 * @param {string} parentId - The ID of the parent folder.
 * @param {string} title - The title of the child folder to find or create.
 * @returns {Promise<string>} The ID of the found or newly created child folder.
 */
export async function getOrCreateChildFolder(parentId, title) {
  const children = await chromeP.bookmarksGetChildren(parentId);
  const found = children.find((c) => !c.url && c.title === title);
  if (found) return found.id;
  const node = await chromeP.bookmarksCreate({ parentId, title });
  return node.id;
}

/**
 * Removes legacy top-level folders created by previous versions, if present.
 * Targets folders named "Raindrop" and "Raindrop Sync" directly under the Bookmarks Bar.
 * This is idempotent and safe to call multiple times.
 *
 * @returns {Promise<void>}
 */
export async function removeLegacyTopFolders() {
  try {
    const barId = await getBookmarksBarFolderId();
    const children = await chromeP.bookmarksGetChildren(barId);
    const toRemove = (children || []).filter(
      (c) =>
        c && !c.url && (c.title === 'Raindrop' || c.title === 'Raindrop Sync'),
    );
    for (const node of toRemove) {
      try {
        await chromeP.bookmarksRemoveTree(node.id);
      } catch (_) {}
    }
  } catch (_) {}
}
