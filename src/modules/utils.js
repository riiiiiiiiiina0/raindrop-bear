import { chromeP } from './chrome.js';

export function invertRecord(record) {
  const inverted = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (v != null) inverted[String(v)] = String(k);
  }
  return inverted;
}

/**
 * Checks if a bookmark node is a descendant of any of the given parent folder IDs.
 *
 * @param {string} nodeId The ID of the node to check.
 * @param {string[]} parentIds An array of parent folder IDs to check against.
 * @returns {Promise<boolean>} True if the node is a descendant, false otherwise.
 */
export async function isDescendant(nodeId, parentIds) {
  if (!nodeId || !parentIds || parentIds.length === 0) {
    return false;
  }

  let currentId = nodeId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    if (parentIds.includes(currentId)) {
      return true;
    }
    try {
      const nodes = await chromeP.bookmarksGet(currentId);
      const node = nodes && nodes[0];
      if (!node || !node.parentId) {
        break;
      }
      currentId = node.parentId;
    } catch (_) {
      break;
    }
  }

  return false;
}
