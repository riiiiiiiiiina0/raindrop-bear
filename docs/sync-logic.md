# Report: Sync Logic

This report details two key aspects of the extension's synchronization process:
1.  How a full vs. incremental download is determined.
2.  How the local Raindrop bookmark folder is located and managed.

---

### 1. Determining Full vs. Incremental Download

The type of download (full or incremental) is determined by the presence of a `lastSync` timestamp in the extension's stored state. This state is managed by functions in `src/modules/state.js` and orchestrated by `performSync` in `src/background.js`.

#### The `lastSync` Timestamp

*   **Location**: The timestamp is stored in Chrome's local storage under a key (likely part of the main state object).
*   **Functionality**:
    *   **No `lastSync` (Full Download)**: If the `lastSync` timestamp is `null` or `undefined`, the extension assumes it's performing an initial sync or a sync after a reset. In this mode, the `syncNewAndUpdatedItems` function (`src/modules/item-sync.js`) fetches all raindrops from the user's account by iterating through every page of the API results.
    *   **`lastSync` Exists (Incremental Download)**: If a `lastSync` timestamp is present, the extension performs an incremental sync. The `syncNewAndUpdatedItems` function fetches raindrops sorted by their last update time (`sort=-lastUpdate`). It stops fetching more items as soon as it encounters an item whose `lastUpdate` timestamp is older than or equal to the stored `lastSync` timestamp. This ensures that only items created or updated since the last sync are downloaded.

#### Trigger for a Full Sync

A full sync is triggered in the following scenarios:
*   **First Installation**: When the extension runs for the first time.
*   **Manual Reset**: If the root bookmark folder is deleted by the user, the `ensureRootAndMaybeReset` function (`src/modules/root-ensure.js`) detects this, creates a new root folder, and clears the `lastSync` timestamp, forcing a full re-download.
*   **Data Corruption/Manual Clearing**: If the extension's local storage is cleared.

---

### 2. Locating the Local Raindrop Folder

The local Raindrop bookmark folder is a folder created in the user's browser bookmarks to mirror their Raindrop.io collections.

#### The Root Folder ("Raindrop.io")

*   **Name**: The root folder is hardcoded with the name **`Raindrop.io`**, defined in `src/modules/bookmarks.js`.
*   **Location**:
    1.  **Parent Folder**: The user can choose a parent folder for the "Raindrop.io" folder on the extension's options page. This selection is saved in the extension's state (`parentFolderId`). If no parent is specified, it defaults to the main **Bookmarks Bar**.
    2.  **Finding the Folder**: The `getOrCreateRootFolder` function (`src/modules/bookmarks.js`) is responsible for finding or creating this folder under the designated parent.
*   **ID Management**:
    1.  **Storage**: Once the "Raindrop.io" folder is located or created, its unique bookmark ID is saved in the extension's state as `rootFolderId`.
    2.  **Verification**: On each sync, the `ensureRootAndMaybeReset` function (`src/modules/root-ensure.js`) verifies that the folder corresponding to `rootFolderId` still exists.
    3.  **Re-creation**: If the folder has been deleted by the user, the extension will re-create it using the logic described above and save the new ID, triggering a full sync to re-populate it.

All other collection folders (mirroring Raindrop collections) are created as sub-folders inside this main "Raindrop.io" root folder.
