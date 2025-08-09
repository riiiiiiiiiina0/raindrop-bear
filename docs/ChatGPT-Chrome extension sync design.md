# Chrome extension sync design

**User:** Qihong (Oscar) Tang (tangqh@sea.com)  
**Created:** 8/9/2025 7:24  
**Updated:** 8/9/2025 9:36  
**Exported:** 8/9/2025 20:22  
**Link:** [https://chatgpt.com/c/68968717-de9c-832b-8db5-736428024a55](https://chatgpt.com/c/68968717-de9c-832b-8db5-736428024a55)  

## Prompt:
I’m planning to implement a chrome extension that perform incremental sync to download raindrop bookmarks to browser bookmarks periodically, preserving folder structure, while not using raindrop’s backup api. The sync process roughly is:

1. Fetch all raindrop groups, root collections, and children collections.

2. Compare local bookmarks folder tree with the raindrop collection tree, with the help of a locally stored raindrop group/collection id to local bookmark folder id map: create new folder for newly added group/collection; delete folder for deleted group/collection; rename folder for renamed group/collection.

3. Use fetch multiple raindrops api to fetch raindrops from collection id 0 (all collections), until we found an item with lastUpdate time older than a locally stored timestamp, put these new/updated item in corresponding local bookmark folder.

4. Use fetch multiple raindrops api to fetch raindrops from collection id map-99 (trash), until we found an item with lastUpdate time older than a locally stored timestamp, delete all corresponding local bookmark items.

Now, please research the relevant raindrop and chrome extension bookmarks data structure and api. Give me a full details architecture and code implementation details of the above mentioned logics.

## Response:
Could you please clarify a few things to tailor the architecture and code accurately?

1.  How often should the incremental sync run (e.g. every hour, every 5 minutes)?
2.  Do you want the extension to run only when Chrome is open, or persist in the background (using alarms or service workers)?
3.  Should the local data (e.g. collection/folder map and last update timestamps) be stored using Chrome storage API or something else?
4.  Are you planning to support any bookmark-specific metadata from Raindrop (e.g. tags, highlights, annotations), or only basic URL-title info?
5.  Do you plan to support bi-directional sync in the future, or is this strictly one-way from Raindrop to Chrome Bookmarks?

Let me know and I’ll begin the detailed architecture and code plan right after.

## Prompt:
1. Every 5 minutes
2. Alarm
3. Chrome storage
4. Basic
5. Yes i plan to support bi-directional sync in future

## Response:
Thanks! I’ll now gather detailed information on the Raindrop.io API (excluding their backup API), Chrome Bookmarks and Storage APIs, and Chrome Extensions' alarm and background sync capabilities. I’ll also consider future extensibility for bidirectional sync. I’ll get back to you with a complete architecture and code implementation plan shortly.

Research completed in 6m · 20 sources · 40 searches

Architecture and Chrome Extension Code for Incremental Raindrop Bookmark Sync

Incremental Bookmark Sync: Raindrop.io to Chrome Bookmarks
==========================================================

Overview and Requirements
-------------------------

We want to **periodically sync Raindrop.io bookmarks to Chrome’s local bookmarks** while preserving the folder (collection) structure. The extension will run a background sync **every 5 minutes** (using Chrome’s alarm API) and perform an **incremental sync** – only new or updated bookmarks since the last sync are fetched and applied. We will avoid using Raindrop’s one-shot backup export; instead, we'll use their REST API to fetch collections and bookmarks incrementally. Key requirements include:

*   Maintaining a **mapping** of Raindrop collection IDs (and group titles) to Chrome bookmark folder IDs (stored in extension storage) so we know where to place bookmarks.
*   Creating, renaming, or deleting local bookmark folders to mirror Raindrop **Collections** (and their grouping) hierarchy.
*   Adding new or updated Raindrop bookmarks into the corresponding local folders, based on their Raindrop collection.
*   Removing local bookmarks that were deleted in Raindrop (i.e. moved to Raindrop’s Trash).
*   Using **Chrome storage** to persist the mapping and the last sync timestamp (so we know what “new” means next time).
*   Using **Chrome Alarms** to schedule the sync function every 5 minutes, and running the sync logic in a background script/service worker.

Below we detail the architecture, data structures, and implementation steps, with code snippets for clarity.

Raindrop.io Data Structures & API Usage
---------------------------------------

Raindrop organizes bookmarks into **Collections**, which can be nested and grouped in the UI’s sidebar. Collections may be grouped under user-defined **Groups** for organization (e.g. “Work” vs “Personal”)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=If%20you%20look%20into%20Raindrop,etc). A **Group** in Raindrop is essentially a category containing a list of top-level collection IDs and a title (but groups themselves do not have unique IDs in the API)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=It%20contains%20,this%20array%20looks%20like%20this). Each Collection has its own ID. We will mirror this grouping and collection structure as folders in Chrome.

**Fetching Collections:** The Raindrop API requires a few calls to retrieve the full collection hierarchy[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=So%20to%20fully%20recreate%20sidebar,improved%20in%20future%20API%20updates)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=Collection%20ID%27s%20listed%20below%20is,to%20get%20child%20items%20separately):

*   **Get User (Groups):** `GET /user` – returns the authenticated user’s info including a `groups` array with group titles and an ordered list of root collection IDs[developer.raindrop.io](https://developer.raindrop.io/v1/user/authenticated#:~:text=,). For example:
    ```json
    "groups": [
      {
        "title": "Home",
        "hidden": false,
        "sort": 0,
        "collections": [ 8364483, 8364403, 66 ]
      },
      {
        "title": "Work",
        "hidden": false,
        "sort": 1,
        "collections": [ 8492393 ]
      }
    ]
    ```
    _This shows two groups (“Home” and “Work”) and the IDs of root collections under each[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=%7B%20,%5B%208364483%2C%208364403)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=%7D%2C%20%7B%20,%5B%208492393%20%5D)._ We will use this to know how to categorize collections into group folders locally.
*   **Get Root Collections:** `GET /collections` – returns an array of all **root collections** (top-level collections) with their details[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20root%20collections). Each collection object includes properties like `_id`, `title`, `lastUpdate`, etc. (We’ll use `_id` and `title` primarily for mapping to local folders).
*   **Get Child Collections:** `GET /collections/childrens` – returns all **nested collections** (sub-folders) that have a parent, with details including their `_id`, `title`, and a `parent.$id` field linking to the parent collection ID[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20child%20collections). Using the root and child lists together, we can reconstruct the entire collection tree.

Using these, the extension will build Raindrop’s folder hierarchy. Essentially, for each Group from the user’s `groups` array, and for each Collection (root or nested), we ensure there is a corresponding Chrome bookmark folder. We’ll maintain a map of Raindrop collection ID -> Chrome folder ID (and possibly group title -> Chrome folder ID for group folders).

**Fetching Bookmarks (Raindrops):** Raindrop’s API for bookmarks allows querying by collection. In particular, we can use the **“Get multiple raindrops”** endpoint:

*   **All Bookmarks:** `GET /raindrops/0` – using collectionId `0` fetches **all bookmarks (raindrops) across all collections** (excluding Trash)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system). We can add query params like `?sort=-lastUpdate&perpage=50&page=0` to get items sorted by most recently updated (newest first). Raindrop uses special IDs: `0` means _All Collections_, `-1` is the **Unsorted** collection, and `-99` is **Trash**[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system). We’ll take advantage of `0` and `-99`. (Note: The default sort is by creation date descending, but user config can set sorting by lastUpdate; we will explicitly sort by lastUpdate descending to catch the latest changes first.)
*   **Trash Bookmarks:** `GET /raindrops/-99` – fetches items in the user’s Trash (these are bookmarks the user deleted)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system). We’ll query this to find which bookmarks were deleted since last sync.

Each Raindrop **bookmark item** returned will have an `_id` (Raindrop’s bookmark ID), a `title`, a `link` (URL), a `lastUpdate` timestamp, and a `collectionId` (often nested inside a `collection` object with `$id`). For example, a JSON item might look like:

```json
{
  "_id": 123456,
  "title": "Example Site",
  "link": "https://example.com",
  "lastUpdate": "2025-07-01T10:23:45.000Z",
  "collectionId": 8364483   // or "collection": { "$id": 8364483 }
}
```

We will use the `collectionId` to determine which local folder to place the bookmark in, and `lastUpdate` to filter new/updated items.

**Authentication:** All these API calls require an access token (bearer token in the Authorization header). The extension would need the user to provide a Raindrop API token (likely via an options page), which we store (e.g. in `chrome.storage.local`) and include in `fetch` requests as:

```js
fetch('https://api.raindrop.io/rest/v1/raindrops/0?sort=-lastUpdate&page=0', {
  headers: { 'Authorization': 'Bearer <RAINDROP_TOKEN>' }
});
```

_(Replace `<RAINDROP_TOKEN>` with the actual token string.)_

Chrome Bookmarks Data Model for Sync
------------------------------------

Chrome’s bookmarks are a tree of nodes. Each node is either a **folder** (which can contain child nodes) or a **bookmark** (with a URL)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=Objects%20and%20properties)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=). Important properties: each node has an `id` (unique within the profile) and `parentId`, and folders have no URL. Chrome provides the `chrome.bookmarks` API to manipulate this tree.

For our sync, we will represent:

*   **Raindrop Groups** as top-level folders (probably under a single umbrella folder for Raindrop). For example, a Raindrop group "Work" could be a folder named "Work" locally. (If the user has only the default “My Collections” group, we might choose to skip creating a folder for it and instead directly use the collections under a main Raindrop folder – implementation choice. But supporting multiple groups means we likely create folders for each group category.)
*   **Raindrop Collections** as sub-folders (nested appropriately). Each collection’s `title` becomes the folder name. Nested collections will appear as nested folders. We map each collection’s Raindrop ID to the Chrome folder’s `id`.
*   **Raindrop Bookmarks** as actual bookmark entries (with title and URL) inside the corresponding collection folder.

**Choosing a Location in Chrome:** We cannot add new top-level nodes at the very root of Chrome’s bookmarks; Chrome has fixed root folders (like the "Bookmarks Bar" and "Other Bookmarks") which cannot be removed or renamed[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=Note%3A%20You%20cannot%20use%20this,folders). We will likely create a parent folder for Raindrop data under one of these (for example, under “Other Bookmarks” since it’s a good place for programmatic bookmarks). For instance, the extension could create an **“Raindrop Bookmarks”** folder in Other Bookmarks, and then inside it create subfolders for each Raindrop Group and Collection.

**Chrome Bookmarks API usage:** Key functions we will use:

*   `chrome.bookmarks.create(details, callback)`: Create a bookmark or folder. If `details.url` is omitted, a folder is created[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=chrome). We specify `parentId` to create it in the right place (e.g. under "Other Bookmarks" or under a specific folder). Example – creating a folder:
    ```js
    chrome.bookmarks.create(
      { parentId: parentFolderId, title: "New Folder Name" }, 
      (newFolder) => { console.log("Created folder", newFolder.id); }
    );
    ```
    This corresponds to creating a folder under `parentFolderId`[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=chrome.bookmarks.create%28%20,). Similarly, to create a bookmark:
    ```js
    chrome.bookmarks.create({
      parentId: collectionFolderId,
      title: "Bookmark Title",
      url: "https://example.com"
    });
    ```
    (No callback is necessary if we don’t need confirmation[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=The%20next%20snippet%20creates%20a,to%20define%20a%20callback%20function).)
*   `chrome.bookmarks.update(id, changes)`: Update a bookmark or folder’s title or URL. We’ll use this to rename folders (if a collection’s name changed) or to update bookmark titles/URLs if they changed remotely. (Note: Chrome does not allow changing a folder’s parent via update; to move a bookmark/folder, use `chrome.bookmarks.move`.)
*   `chrome.bookmarks.remove(id)`: Remove a bookmark. (`chrome.bookmarks.removeTree(id)` to remove a folder and all its children in one call – useful if a collection folder was deleted).
*   `chrome.bookmarks.search` or `getChildren`: We might use these to find existing items if we don’t have them mapped, but ideally we keep a mapping. We will maintain a mapping of Raindrop IDs to Chrome IDs so we can avoid expensive searches.

**Bookmark ID Persistence:** Chrome bookmark `id` values are stable for a profile (they remain valid across browser restarts for the same bookmark)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=string). We will rely on that and store those IDs. (If the user deletes the extension’s created folders manually, the IDs would be invalid, but that’s outside normal operation – we could handle errors if something is missing by recreating as needed.)

**Chrome Storage for State:** We will use `chrome.storage.local` (or `chrome.storage.sync`) to persist data such as:

*   The **mapping object**: e.g. an object mapping Raindrop collection IDs to Chrome folder IDs. Also possibly mapping Raindrop group titles (or a hash) to Chrome folder IDs if groups are used. We might also map individual Raindrop bookmark IDs to Chrome bookmark IDs for quick update/delete, but we can also find bookmarks by searching within a folder by URL if needed. Storing item mappings is helpful for detecting “update vs new” – if an item’s ID is already in mapping, update it; if not, create it.
*   The **lastSyncTime**: a timestamp (perhaps store as ISO string or numeric) of the last time we synced. This will be used to filter new changes. For example, if lastSyncTime = `2025-07-01T10:00:00Z`, we will fetch all raindrops updated after that.

Chrome storage allows saving simple objects. For example:

```js
chrome.storage.local.set({ 
  lastSync: lastSyncISO, 
  collectionMap: raindropToChromeMap 
});
```

And reading it back later with `chrome.storage.local.get(["lastSync","collectionMap"], ...)`. Using storage ensures our data persists across extension restarts and can be accessed by the background script when it runs.

Incremental Sync Workflow
-------------------------

Now let's outline the **sync logic** that runs every 5 minutes (triggered by an alarm). The steps correspond to what you described:

1.  **Fetch Raindrop Groups and Collections:** Use Raindrop API to get the latest structure. First, call **`GET /user`** to get the `groups` array (for group titles and ordering)[developer.raindrop.io](https://developer.raindrop.io/v1/user/authenticated#:~:text=,). Then call **`GET /collections`** for root collections and **`GET /collections/childrens`** for nested collections[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20root%20collections)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20child%20collections). Combine these results to build a full list of all collections with their IDs, parent IDs (if any), and titles.
    *   From the `groups` data, determine the grouping. For each group in the array, ensure there's a corresponding **group folder** in Chrome (under our Raindrop main folder). If a group folder doesn’t exist locally yet, create it. Use `chrome.bookmarks.create` with the “Raindrop” root folder as parent and the group title as name. Save the folder’s ID in our map (keyed by group title or an index). If it exists but the name has changed, use `chrome.bookmarks.update(folderId, {title: newName})` to rename it. If a group from last sync no longer exists (was removed/renamed), we might remove that folder – however, groups likely only change if user renames them or if collections moved groups. (Since groups don’t have stable IDs, matching by title or by contained collections may be needed. We could also regenerate groups fresh each time: e.g. delete all group folders not in current `groups` list and then re-create/rename as needed, since group changes are probably rare.)
    *   For each **Collection** (root or nested) from Raindrop, ensure a corresponding **bookmark folder** exists. Determine its intended parent folder in Chrome: if the collection has a parent (another collection) in Raindrop, then its parent folder is the folder mapped to that parent collection; if it’s a root collection under a group, the parent is the group’s folder. Create the folder if it’s new (using `chrome.bookmarks.create({parentId: appropriateParentId, title: collection.title})`). If it already exists but the title changed, update it (`chrome.bookmarks.update`). If a collection was deleted in Raindrop (i.e. its ID is not present in the fetched list but we had it in our previous map), then remove that folder from Chrome (`chrome.bookmarks.removeTree(folderId)` to delete folder and all its bookmarks). Also update the mapping (remove that ID).
    _Data Mapping:_ While doing this, maintain/update the mapping of `collectionId -> folderId` in memory. After processing all collections, save the updated map to `chrome.storage`. This mapping is crucial for the next steps to place bookmarks correctly.
2.  **Sync New/Updated Bookmarks:** Now fetch the actual bookmarks that are new or modified since last sync. We use **`GET /raindrops/0`** (all collections) with sorting by lastUpdate descending[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=collectionId). We will paginate through results until we reach items that were last updated _before_ our last sync timestamp. The logic:
    *   Retrieve `lastSyncTime` from storage (if none exists, treat it as a very old date or 0 – meaning we’ll fetch everything once).
    *   Call `GET /raindrops/0?sort=-lastUpdate&perpage=50&page=0` (50 is max per page). The first page gives the 50 most recently updated bookmarks across all collections (excluding trash). For each bookmark item in the response, check its `lastUpdate` timestamp. If the timestamp is **newer than** (more recent than) our `lastSyncTime`, it means this bookmark was added or updated since last sync, so we need to sync it. If we encounter an item with `lastUpdate` older or equal to `lastSyncTime`, we can stop – all further items will be older (since sorted descending). If we haven’t hit an older item by the end of the page, and the API indicates more pages (there is a `count` of total or `lastPage` flag), then fetch the next page (`page=1`, etc.) and continue until we cover all new items or run out of pages.
    *   For each Raindrop bookmark that is new/updated:
        *   Determine the local target folder via its `collectionId` → find the Chrome folder ID from our mapping (from step 1). If the collection mapping isn’t found (unexpected, unless maybe it’s in "Unsorted" or a new collection we didn't handle yet), handle accordingly (e.g. create an "Unsorted" folder if needed for collection -1, then map it).
        *   Check if we have this Raindrop item already in our local bookmarks (we might have a mapping of Raindrop bookmark ID -> Chrome ID from a previous sync). If we have a mapping entry for this item ID, that means it exists locally – so we **update** it. Use `chrome.bookmarks.update(localId, { title: item.title, url: item.link })` to ensure title and URL match the latest. Also, if the item’s collection changed (meaning its folder should be different), then use `chrome.bookmarks.move(localId, { parentId: newFolderId })` to move it to the correct folder.
        *   If we do _not_ have a record of this Raindrop ID, it’s a **new bookmark** – create it. Use `chrome.bookmarks.create({ parentId: folderId, title: item.title, url: item.link })`. The Chrome API will return the new bookmark node (with an `id`). Store the mapping of Raindrop item ID -> Chrome bookmark ID for future use (especially needed when we implement bi-directional sync or to update next time).
        *   Edge case: if a Raindrop bookmark is of a type that Chrome can’t handle (e.g. a Raindrop article or video that doesn’t have a URL – though Raindrop items always have a URL or file link, so this should be fine), we might skip or handle specially. Generally, treat them as normal bookmarks.
    *   **Update lastSyncTime:** We should calculate a new `lastSyncTime` after processing new/updated items. A safe approach is to take the **maximum** `lastUpdate` of all items we processed (or simply the current time at sync completion, as that covers everything up to now). We will store this back in `chrome.storage.local` so that next run we only fetch changes after this. (If using current time, ensure using consistent time source; using the newest `lastUpdate` from Raindrop’s data might be more precise in case of slight clock differences.)
3.  **Sync Deleted Bookmarks (Trash):** Next, handle removals. We call **`GET /raindrops/-99`** to get items in Trash (i.e. deleted Raindrop bookmarks)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system). We will do a similar process: fetch `?sort=-lastUpdate` and check each trash item’s `lastUpdate` against `lastSyncTime`. If it was moved to trash after our last sync, we need to remove it locally. Use pagination if needed just like above (though deletes volume is typically low).
    *   For each trash item with `lastUpdate` newer than lastSync: find the corresponding local bookmark. We likely have its Raindrop `_id` and perhaps a mapping to a Chrome ID. If we kept an item mapping, just look it up and call `chrome.bookmarks.remove(itemFolderId)` to delete it. If we did not store item mappings, we can locate it by searching the expected folder: the trash item should have a `collectionId` (the collection it used to belong to, possibly) – if so, find the folder for that collection and search within for a bookmark with matching URL (and title). Alternatively, we could search the entire bookmark tree for that URL or a unique marker. However, maintaining an ID map is straightforward and reliable.
    *   Delete the bookmark from Chrome. Also remove its entry from our mapping of item IDs (if we store that).
    *   (We do **not** create any local "Trash" folder – we simply remove the bookmark. If the user wants a backup, they presumably have Raindrop’s trash still. The goal is to mirror current state.)
    Additionally, if a **collection** was deleted in Raindrop, it wouldn't appear in the collections list we fetched in step 1. We already handled removal of its folder in step 1 by comparing to previous map. If we hadn’t, we should also handle it: Raindrop might actually move all bookmarks of a deleted collection to Trash as well (depending on how Raindrop works). Regardless, we covered folder removal earlier.
4.  **Finalize:** After processing adds/updates and deletions, our Chrome bookmarks should reflect Raindrop’s state as of now. Save the updated mapping and update the stored `lastSyncTime` in `chrome.storage` so the next cycle knows where to continue. This completes one sync cycle.

**Workflow Summary in Pseudocode:**

```js
async function performSync() {
  const { lastSync, collectionMap, itemMap } = await chrome.storage.local.get(['lastSync','collectionMap','itemMap']);
  let lastSyncTime = lastSync || 0;  // if not set, sync everything

  // 1. Fetch groups and collections from Raindrop
  const userData = await apiGET('/user');
  const groups = userData.user.groups || [];
  const rootCols = await apiGET('/collections');    // root collections list
  const childCols = await apiGET('/collections/childrens'); // nested collections list
  const allCollections = combineCollections(rootCols.items, childCols.items);
  
  // Ensure group folders and collection folders exist/updated
  for (let group of groups) {
    ensureGroupFolder(group.title);
    for (let colId of group.collections) {
      const col = findById(allCollections, colId);
      if (col) ensureCollectionFolder(col, parentFolderId = folderIdForGroup(group.title));
    }
  }
  // Also handle any nested collections not listed directly in groups (they'll be handled in ensureCollectionFolder recursively)

  // 2. Fetch new/updated bookmarks since last sync
  let newLastSyncTime = new Date(lastSyncTime); // we'll update as we go
  let page = 0;
  let stop = false;
  while (!stop) {
    const res = await apiGET(`/raindrops/0?sort=-lastUpdate&perpage=50&page=${page}`);
    for (let item of res.items) {
      if (new Date(item.lastUpdate) <= lastSyncTime) { 
        stop = true; 
        break; 
      }
      // Process this updated/new item
      const colFolderId = collectionMap[item.collectionId];
      if (!colFolderId) {
        console.warn("Missing folder for collection", item.collectionId);
        continue;
      }
      if (itemMap[item._id]) {
        // exists locally -> update
        const localId = itemMap[item._id];
        chrome.bookmarks.update(localId, { title: item.title, url: item.link });
        // If moved collection:
        chrome.bookmarks.move(localId, { parentId: colFolderId });
      } else {
        // new bookmark -> create
        chrome.bookmarks.create({ parentId: colFolderId, title: item.title, url: item.link }, (node) => {
          itemMap[item._id] = node.id;
        });
      }
      // Update newLastSyncTime to latest
      if (new Date(item.lastUpdate) > newLastSyncTime) {
        newLastSyncTime = new Date(item.lastUpdate);
      }
    }
    if (stop || res.items.length < 50) break;
    page++;
  }

  // 3. Fetch trash (deleted) items since last sync
  page = 0;
  stop = false;
  while (!stop) {
    const res = await apiGET(`/raindrops/-99?sort=-lastUpdate&perpage=50&page=${page}`);
    for (let item of res.items) {
      if (new Date(item.lastUpdate) <= lastSyncTime) {
        stop = true;
        break;
      }
      // For each deleted item, remove local bookmark
      const localId = itemMap[item._id];
      if (localId) {
        chrome.bookmarks.remove(localId);
        delete itemMap[item._id];
      } else {
        // if not in map, try find by URL in the corresponding folder (optional fallback)
        const folderId = collectionMap[item.collectionId];
        if (folderId) {
          chrome.bookmarks.getChildren(folderId, (children) => {
            const toRemove = children.find(bm => bm.url === item.link);
            if (toRemove) chrome.bookmarks.remove(toRemove.id);
          });
        }
      }
    }
    if (stop || res.items.length < 50) break;
    page++;
  }

  // 4. Save updated state
  await chrome.storage.local.set({ 
    lastSync: newLastSyncTime.toISOString(), 
    collectionMap, 
    itemMap 
  });
}
```

_(Note: `apiGET` is a helper to call fetch with the Authorization header, not a built-in function.)_

The above pseudo-code illustrates the main logic flow inside the sync function. It handles folder sync, new/updated bookmarks, and deletions.

Chrome Extension Implementation Details
---------------------------------------

With the logic in place, here’s how to integrate it into a Chrome extension:

**Background Script / Service Worker:** The sync logic will run in the background. In Manifest V3, this could be a service worker (`background.js`). We need to ensure it runs periodically. Chrome provides the **Alarms API** for periodic tasks. We’ll use it as follows:

*   In the extension’s manifest, include `"permissions": ["bookmarks", "storage", "alarms"]` since we need to use those APIs (bookmarks and storage are not content script APIs, they require declaring permissions, as does alarms)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=You%20must%20declare%20the%20,For%20example)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/alarms#:~:text=Permissions). Also ensure the background script is declared.
*   When the extension is installed or started, set up the alarm. For example, in `background.js`:
    ```js
    chrome.runtime.onInstalled.addListener(() => {
      // Create a repeating alarm that triggers every 5 minutes
      chrome.alarms.create('raindrop-sync', { periodInMinutes: 5 });
    });
    ```
    This uses `chrome.alarms.create` with a name and a period. (We omit `delayInMinutes` so it starts after 5 minutes, or we could specify a small initial delay for first run)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/alarms#:~:text=await%20chrome.alarms.create%28%27demo,periodInMinutes%3A%201). The alarm will fire on that schedule.
*   Add a listener for the alarm event:
    ```js
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'raindrop-sync') {
        performSync();  // call our sync routine (make sure to handle promises or use async appropriately)
      }
    });
    ```
    Now every 5 minutes, `performSync` will be invoked. This function is the one we sketched out above. It should use the Raindrop API (via fetch) and Chrome bookmarks calls as described. Since the service worker might not stay alive constantly, make sure to handle asynchronous code properly (in MV3, returning a Promise or using `await` in the listener can keep the worker alive until completion).

**Using Chrome Storage:** Before the first sync, the extension might not have any `lastSync` timestamp. We could initialize it to 0 or some default. For example, on first run, set `lastSync` to a very old date (or simply handle the logic that if no `lastSync` is set, the code fetches everything once). The mapping objects (`collectionMap` and possibly `itemMap`) should be initialized as empty `{}` on first run. We store them after each sync. Chrome storage can be used directly in the background script (it’s asynchronous). In MV3, you can use either callback or the promise-based `.get` and `.set` (like `chrome.storage.local.get([...]).then(...)`). The pseudo-code above used `await chrome.storage.local.get` assuming a promise-based usage (you could also wrap callbacks).

**Handling API Rate Limits & Errors:** We should be mindful that calling the Raindrop API every 5 minutes is okay for incremental data (Raindrop’s API should handle this rate, though we should check their rate limits if any). Each sync does a few calls: 3 calls for collections (only once every 5 min, not heavy), and then paginated calls for raindrops and trash. If the user has thousands of bookmarks and the first sync fetches all, it will paginate through 50 at a time. That could be many calls initially, but subsequent syncs will be small. We might implement a safety mechanism (like if initial sync has a huge number of pages, perhaps use a longer delay or chunk the work). But since this runs in background, it's usually fine as long as we don’t exceed any limits.

If any fetch fails (network issues, etc.), handle gracefully – maybe retry on next alarm or schedule an earlier retry. We also should ensure the extension doesn’t run multiple syncs in parallel if one takes longer than 5 minutes (unlikely if modest data, but if so, we might set a flag in storage while running or manage the promise).

**Bi-Directional Sync Considerations:** The current architecture is one-way (Raindrop -> Chrome). You indicated future plans for two-way sync (i.e., if the user adds/edits bookmarks in Chrome, push those changes back to Raindrop). The design we chose will help with that because:

*   We maintain mappings of IDs, which allows us to identify a local bookmark’s corresponding Raindrop item.
*   To implement bi-directional, we can use Chrome’s bookmark change listeners. For example, `chrome.bookmarks.onCreated.addListener`, `onRemoved`, `onChanged` (for edits), and `onMoved`. These events would let us detect user actions in Chrome. We would then call the Raindrop API (e.g. **Create Raindrop** `POST /raindrop` or **Update Raindrop** `PUT /raindrop/{id}`[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/single#:~:text=Update%20raindrop)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/single#:~:text=type), or **Remove Raindrop** which actually moves to trash[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/single#:~:text=Remove%20raindrop)) to propagate changes. We’d have to decide how to handle new local bookmarks (perhaps place them in a special "Unsynced" or default collection on Raindrop) and how to avoid loops (we should distinguish changes initiated by sync vs user manual changes – often by setting flags or temporarily disabling listeners during sync updates). These are future design concerns.

For now, our one-way sync lays the groundwork. Each Raindrop item’s `_id` can be stored in the Chrome bookmark’s metadata if needed (though Chrome bookmarks have no arbitrary metadata field accessible to extensions, except maybe using the title to embed an ID – which is messy). It’s better to keep the `itemMap` in extension storage. That map and the collectionMap will be crucial for syncing back changes.

Conclusion
----------

**Architecture Summary:** We have a background script that on a 5-minute interval fetches Raindrop’s latest data (collections and bookmarks) and updates Chrome’s bookmarks accordingly. We use Raindrop’s REST API endpoints (`/user`, `/collections`, `/raindrops/0`, `/raindrops/-99`) to get the needed info, leveraging special collection IDs (0 for all, -99 for trash)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system). We preserve the folder hierarchy by mirroring Raindrop’s groups and collections as folders. Chrome’s Bookmarks API is used to create/update/delete those folders and bookmarks (observing its rules, e.g. not touching root folders)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=Note%3A%20You%20cannot%20use%20this,folders). All state (ID mappings and last sync time) is stored in `chrome.storage` so that each sync iteration knows what to do and we don’t duplicate bookmarks. The sync runs on an alarm timer in the background[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/alarms#:~:text=service), ensuring the data stays up-to-date with minimal delay.

By following this design, the extension will efficiently keep the browser’s bookmarks in sync with Raindrop.io, and it’s structured in a way that adding reverse sync (Chrome -> Raindrop) in the future is feasible. Each part of the implementation can be developed and tested independently (e.g. folder sync vs bookmark sync vs delete handling), resulting in a robust bookmark synchronization Chrome extension.

**Sources:**

*   Raindrop.io API – Collections and Raindrops documentation (for understanding groups, collections, and query parameters)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/nested-structure#:~:text=If%20you%20look%20into%20Raindrop,etc)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20root%20collections)[developer.raindrop.io](https://developer.raindrop.io/v1/collections/methods#:~:text=Get%20child%20collections)[developer.raindrop.io](https://developer.raindrop.io/v1/raindrops/multiple#:~:text=Path%20parameter%20that%20specify%20from,Or%20specify%20one%20of%20system)
*   Chrome Extension Developer Documentation – Bookmarks and Alarms API (for using bookmark operations and scheduling periodic tasks)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=Note%3A%20You%20cannot%20use%20this,folders)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/bookmarks#:~:text=chrome.bookmarks.create%28%20,)[developer.chrome.com](https://developer.chrome.com/docs/extensions/reference/api/alarms#:~:text=service).



---
Powered by [ChatGPT Exporter](https://www.chatgptexporter.com)