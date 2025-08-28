import { chromeP } from './chrome.js';
import { loadState } from './state.js';

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

  // Use the parent folder ID from state, or default to the bookmarks bar
  const parentFolderId =
    state.parentFolderId || (await getBookmarksBarFolderId());

  const children = await chromeP.bookmarksGetChildren(parentFolderId);
  // Find all folders with the root folder name, not just the first one.
  const existingFolders = children.filter(
    (c) => c.title === ROOT_FOLDER_NAME && !c.url,
  );

  // If we have more than one, it's an ambiguous situation.
  // The best approach is to remove them all and start fresh with a full sync.
  if (existingFolders.length > 1) {
    // Nuke all found folders.
    for (const folder of existingFolders) {
      await chromeP.bookmarksRemoveTree(folder.id);
    }
    // Force a full re-sync by clearing all state.
    await saveState({
      lastSync: null,
      rootFolderId: null,
      collectionMap: {},
      groupMap: {},
      itemMap: {},
    });
    // Fall through to create a new folder from scratch.
  } else if (existingFolders.length === 1) {
    const existing = existingFolders[0];
    await saveState({ rootFolderId: existing.id });
    return existing.id;
  }

  // This part runs if there were no folders, or if we just deleted multiple.
  const node = await chromeP.bookmarksCreate({
    parentId: parentFolderId,
    title: ROOT_FOLDER_NAME,
  });
  await saveState({ rootFolderId: node.id });
  return node.id;
}

/**
 * Recursively gets all bookmark folders.
 *
 * @returns {Promise<{folder: chrome.bookmarks.BookmarkTreeNode, path: string}[]>}> A list of all bookmark folders with their full path.
 */
export async function getAllBookmarkFolders() {
  // Fetch bookmark tree and current Raindrop root folder id (if any)
  const { rootFolderId } = await loadState();

  const tree = await chromeP.bookmarksGetTree();
  const folders = [];

  function findFolders(node, parentPath) {
    if (!node?.children) return;
    for (const child of node.children) {
      // Skip bookmark nodes (those having url) and the Raindrop root folder subtree
      if (child.url) continue;
      if (rootFolderId && child.id === rootFolderId) {
        // Do not include the Raindrop root folder or traverse into it
        continue;
      }
      const path = `${parentPath} / ${child.title}`;
      folders.push({ folder: child, path });
      findFolders(child, path);
    }
  }

  findFolders(tree[0], '');
  return folders;
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
      (c) => c && !c.url && c.title === 'Raindrop Sync',
    );
    for (const node of toRemove) {
      try {
        await chromeP.bookmarksRemoveTree(node.id);
      } catch (_) {}
    }
  } catch (_) {}
}
