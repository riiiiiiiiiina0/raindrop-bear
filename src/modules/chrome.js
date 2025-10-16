// Chrome API promisified helpers
export const chromeP = {
  /**
   * Promisified wrapper for chrome.storage.local.get.
   * @param {string|string[]} keys - A string or array of strings specifying keys to get.
   * @returns {Promise<Object>} Resolves with the storage items.
   */
  storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },

  /**
   * Promisified wrapper for chrome.storage.local.set.
   * @param {Object} values - An object which gives each key/value pair to update storage with.
   * @returns {Promise<void>} Resolves when the values are set.
   */
  storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  },

  /**
   * Promisified wrapper for chrome.storage.sync.get.
   * @param {string|string[]} keys - A string or array of strings specifying keys to get.
   * @returns {Promise<Object>} Resolves with the storage items.
   */
  storageSyncGet(keys) {
    return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
  },

  /**
   * Promisified wrapper for chrome.storage.sync.set.
   * @param {Object} values - An object which gives each key/value pair to update storage with.
   * @returns {Promise<void>} Resolves when the values are set.
   */
  storageSyncSet(values) {
    return new Promise((resolve) => chrome.storage.sync.set(values, resolve));
  },

  /**
   * Promisified wrapper for chrome.bookmarks.create.
   * @param {chrome.bookmarks.CreateDetails} details - Details of the bookmark or folder to create.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the created bookmark node.
   */
  bookmarksCreate(details) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.create(details, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.update.
   * @param {string} id - The ID of the bookmark or folder to update.
   * @param {Object} changes - An object with the changes to apply.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the updated bookmark node.
   */
  bookmarksUpdate(id, changes) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.update(id, changes, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.move.
   * @param {string} id - The ID of the bookmark or folder to move.
   * @param {Object} destination - An object specifying the destination.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode>} Resolves with the moved bookmark node.
   */
  bookmarksMove(id, destination) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.move(id, destination, (node) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(node);
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.remove.
   * @param {string} id - The ID of the bookmark or folder to remove.
   * @returns {Promise<void>} Resolves when the bookmark is removed.
   */
  bookmarksRemove(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.remove(id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.removeTree.
   * @param {string} id - The ID of the bookmark tree to remove.
   * @returns {Promise<void>} Resolves when the bookmark tree is removed.
   */
  bookmarksRemoveTree(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.removeTree(id, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.get.
   * @param {string|[string, ...string[]]} id - The ID or array of IDs of the bookmarks to retrieve.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with an array of bookmark nodes.
   */
  bookmarksGet(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.get(id, (nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.getChildren.
   * @param {string} id - The ID of the folder whose children are to be retrieved.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with an array of child bookmark nodes.
   */
  bookmarksGetChildren(id) {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.getChildren(id, (nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },

  /**
   * Promisified wrapper for chrome.bookmarks.getTree.
   * @returns {Promise<chrome.bookmarks.BookmarkTreeNode[]>} Resolves with the complete bookmarks tree.
   */
  bookmarksGetTree() {
    return new Promise((resolve, reject) =>
      chrome.bookmarks.getTree((nodes) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(nodes);
      }),
    );
  },
};
