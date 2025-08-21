# Report: Raindrop Item Deletion Triggers

This report outlines the various mechanisms within the browser extension that can trigger the deletion of items (raindrops) or collections from the Raindrop.io service.

---

### 1. Deletion of Local Bookmarks

*   **Trigger**: A user manually deletes a bookmark or a bookmark folder from within their web browser's native bookmark manager (e.g., `chrome://bookmarks`).
*   **Mechanism**: The extension listens for bookmark removal events (`chrome.bookmarks.onRemoved`). When a synced bookmark or folder is deleted locally, the extension mirrors this action by deleting the corresponding item on Raindrop.
*   **Details**:
    *   **File**: `src/background.js`
    *   **Function**: The event listener for `chrome.bookmarks.onRemoved`.
    *   **API Call**:
        *   For single items: `DELETE /raindrop/{raindropId}`
        *   For collections (folders): `DELETE /collection/{collectionId}`

---

### 2. Remote Deletions Synced Locally

*   **Trigger**: An item is deleted directly from the Raindrop.io website, the official Raindrop.io app, or any other application connected to the user's Raindrop account.
*   **Mechanism**: The extension has a periodic background sync process. During this sync, it fetches a list of items that have been moved to the trash on Raindrop since the last sync. It then deletes the corresponding local bookmarks to keep the browser's bookmark structure consistent with Raindrop.
*   **Details**:
    *   **File**: `src/modules/item-sync.js`
    *   **Function**: `syncDeletedItems()`
    *   **API Call**: `GET /raindrops/-99` (to fetch trashed items). The deletion itself is a local browser action (`chrome.bookmarks.remove()`), not a direct API deletion call from this module.

---

### 3. Deletion of a "Saved Project"

*   **Trigger**: A user deletes a "Saved Project" from the extension's interface. In the Raindrop data model, a "Saved Project" is a standard collection.
*   **Mechanism**: This action directly calls the Raindrop API to delete the entire collection associated with the project.
*   **Details**:
    *   **File**: `src/modules/projects.js`
    *   **Function**: `deleteSavedProject()`
    *   **API Call**: `DELETE /collection/{collectionId}`

---

### 4. Replacement of a "Saved Project"

*   **Trigger**: A user chooses to replace an existing "Saved Project" with a new set of tabs.
*   **Mechanism**: This operation is effectively a delete-and-replace. The extension creates a new collection for the new tabs and then deletes the old collection that was previously associated with the project.
*   **Details**:
    *   **File**: `src/modules/projects.js`
    *   **Function**: `replaceSavedProjectWithTabs()`
    *   **API Call**: `DELETE /collection/{collectionId}` (to remove the old collection).

---

### 5. "Window Sync" Feature

*   **Trigger**: The "Window Sync" feature is enabled for a browser window. This feature keeps a Raindrop collection in perfect sync with the tabs of that window.
*   **Mechanism**: On a schedule (every time a tab changes), this feature completely wipes all existing raindrops from the linked collection and replaces them with the current set of tabs. This is a recurring bulk deletion.
*   **Details**:
    *   **File**: `src/modules/window-sync.js`
    *   **Function**: `overrideCollectionWithWindowTabs()`
    *   **API Call**: `DELETE /raindrops/{collectionId}` (a bulk deletion of all items in the collection).

---

### 6. Removal of Duplicate Items

*   **Trigger**: A user runs the "Find Duplicates" tool on the extension's options page and then clicks the "Remove Duplicates" button.
*   **Mechanism**: The tool identifies items with the same URL within the same collection. When the user confirms, the extension sends a single API request to delete all the identified duplicate items in one batch.
*   **Details**:
    *   **File**: `src/options.js`
    *   **Function**: The event listener for the "remove-duplicates" button.
    *   **API Call**: `DELETE /raindrops/{collectionId}` (with a request body containing an array of specific `ids` to delete). This is a targeted bulk deletion.

---
