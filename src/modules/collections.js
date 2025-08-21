// Groups and collections fetching and indexing utilities
import { chromeP } from './chrome.js';
import { apiGET } from './api-facade.js';

/**
 * Recursively finds all bookmark folders with a specific title.
 *
 * @param {string} title The title of the folder to find.
 * @returns {Promise<string[]>} A list of IDs of the found folders.
 */
export async function getFoldersByTitle(title) {
  const tree = await chromeP.bookmarksGetTree();
  const folders = [];

  function findFolders(node) {
    if (!node?.children) return;
    for (const child of node.children) {
      if (!child.url && child.title === title) {
        folders.push(child.id);
      }
      findFolders(child);
    }
  }

  if (tree && tree.length > 0) {
    findFolders(tree[0]);
  }
  return folders;
}

/**
 * @typedef {{ title: string, sort?: number, collections?: number[] }} RaindropGroup
 */

/**
 * @typedef {{ _id: number, title?: string, parent?: { $id?: number }|number, sort?: number }} RaindropCollection
 */

export async function fetchGroupsAndCollections() {
  const [userRes, rootsRes, childrenRes] = await Promise.all([
    apiGET('/user'),
    apiGET('/collections'),
    apiGET('/collections/childrens'),
  ]);
  const groups = Array.isArray(userRes?.user?.groups)
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

export function buildCollectionsIndex(rootCollections, childCollections) {
  const byId = new Map();
  for (const c of rootCollections || []) {
    if (!c || c._id == null) continue;
    byId.set(c._id, {
      id: c._id,
      title: c.title || '',
      parentId: null,
      sort: typeof c.sort === 'number' ? c.sort : undefined,
    });
  }
  for (const c of childCollections || []) {
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
  return byId;
}

export function buildCollectionToGroupMap(groups) {
  const map = new Map();
  for (const g of groups || []) {
    const title = g && g.title ? g.title : '';
    const ids = Array.isArray(g.collections) ? g.collections : [];
    for (const id of ids) map.set(id, title);
  }
  return map;
}

export function computeGroupForCollection(
  collectionId,
  collectionsById,
  rootCollectionToGroupTitle,
) {
  let currentId = collectionId;
  const visited = new Set();
  while (currentId != null && !visited.has(currentId)) {
    visited.add(currentId);
    const info = collectionsById.get(currentId);
    if (!info) break;
    if (info.parentId == null)
      return rootCollectionToGroupTitle.get(info.id) || '';
    currentId = info.parentId;
  }
  return '';
}

export function computeRootCollectionId(collectionId, collectionsById) {
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
