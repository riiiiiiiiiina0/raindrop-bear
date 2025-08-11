# Tabs and Tab Groups Sync (Design)

This document describes the design for syncing browser windows, tabs, and tab groups bi-directionally via a special Raindrop group. Unlike existing bookmark mirroring, everything inside this special group will not be written to the browser bookmarks. Instead, it maps to live browser state (windows, pinned tabs, tab groups, tabs) across devices/browsers.

## Goals

- Use a special Raindrop group (default: "Browser tabs") to represent browser windows and tabs.
- Do not mirror this group into Chrome bookmarks (keep current bookmark sync as-is for all other content).
- Bi-directional sync:
  - Cloud → Browser: Create/update windows, groups, and tabs based on Raindrop.
  - Browser → Cloud: Reflect live browser changes into Raindrop collections and items.
- Stable ordering across devices using index prefixes in titles.

## Data Model Mapping

Within the special group (e.g., "Browser tabs"):

- Root collection = a browser window
- Child collection named "**Pinned**" = pinned tabs in that window
- Other child collections = tab groups in that window (collection title = group title)
- Items under collections = tabs (only http/https URLs)

Example structure:

- Group: "Browser tabs"
  - Root collection: "[0] Window 1"
    - Child collection: "[0] **Pinned**" → pinned tabs
      - Item: "[0] GitHub - PR" → https://...
      - Item: "[1] Docs" → https://...
    - Child collection: "[1] [Work]" → tab group
      - Item: "[0] Spec" → https://...
      - Item: "[1] Jira" → https://...
    - Item: "[2] News" → https://... (ungrouped tab)
  - Root collection: "[1] Window 2"

## Ordering Rules (Unified)

- Every child of a collection carries an index prefix in its title, even if the child is a collection.
- Format: "[n] <title>" with contiguous zero-based indices per parent.
- Parsing regex: `/^\[(\d+)\]\s*(.*)$/`
- Where indices apply:
  - Window collection (a browser window): children are a mixed sequence of:
    - The special child collection "**Pinned**" (always first, index 0)
    - Child collections (tab groups) in tab-strip order
    - Child items (ungrouped tabs) in tab-strip order
  - "**Pinned**" collection: children are pinned tabs, ordered by their tab index
  - A group collection: children are tabs in that group, ordered by tab index within the group block

### Browser → Cloud: building the order

- For each window:
  - Insert "**Pinned**" as index 0.
  - Scan unpinned tabs by `tab.index` and build a mixed sequence:
    - First occurrence of a `tab.groupId` introduces a child collection entry for that group at the position of its first member.
    - Ungrouped tabs are inserted as child items at their positions.
- Inside "**Pinned**": order tabs by pinned `tab.index`.
- Inside each group: order tabs by their index relative to other tabs in the same group.
- Update collection/item titles to include `[index]` prefixes.

### Cloud → Browser: applying the order

- Window root:
  - Sort children by parsed `[index]`.
  - Ensure a pinned block exists and stays left (index 0).
  - For each child in order:
    - Child collection → ensure/move corresponding tab group to that slot via `chrome.tabGroups.move(...)`.
    - Child item → ensure/create ungrouped tab and move to that `index`.
- "**Pinned**": move/ensure all child items are pinned and ordered by `[index]`.
- Group collection: ensure/move tabs inside the group ordered by `[index]`.

## Permissions & Options

- Manifest: add permission "tabGroups" alongside existing "tabs".
- Options UI additions:
  - Toggle: "Enable Tabs & Tab Groups Sync" (default ON)
  - Text: "Tabs Group Title" (default "Browser tabs")
  - Optional buttons: "Rebuild cloud from this browser" and "Rebuild browser from cloud"

## Storage Keys

- `tabsSyncEnabled: boolean` (default true)
- `tabsGroupTitle: string` (default "Browser tabs")
- `tabsWindowMap: Record<raindropCollectionId, chromeWindowId>`
- `tabsGroupCollectionMap: Record<childCollectionId, tabGroupId>`
- `tabsItemMap: Record<raindropItemId, tabId>`
- `tabsLastSync: string | null` (optional high-water mark)
- `machineLabel: string` (optional; to label windows created from a given device)

Note: These maps are primarily session-scoped. Persist if helpful for stability across restarts.

## Raindrop API Usage

- GET `/user` → find groups (to locate the tabs group)
- PUT `/user` → create or update groups via `groups` array (e.g., ensure the special "Browser tabs" group exists; manage `title`, `hidden`, `sort`, and `collections` ordering of root collections)
- GET `/collections`, `/collections/childrens` → enumerate window/group collections
- GET `/raindrops/{collectionId}?perpage=500` → list tabs/items in a collection
- POST `/collection` → create window or child collections (groups, `__Pinned__`)
- PUT `/collection/{id}` → rename (write `[index]` prefixes) or change parent
- POST `/raindrop` → create a tab item
- PUT `/raindrop/{id}` → rename (write `[index]` prefix), update link, move collection
- DELETE `/raindrop/{id}` → delete tab item
- Optional: POST `raindrops` for bulk creates

## Background Integration

1. Exclude the special group from bookmark mirroring:
   - When fetching groups/collections in the existing sync, identify the configured tabs group by its title and exclude all of its collections before calling bookmark folder/item sync routines.
2. New tabs sync pipeline after bookmark sync:
   - If enabled, perform tabs sync (cloud → browser reconciliation).
   - Register event listeners to mirror browser changes to Raindrop (local → cloud).

## New Module: `src/modules/tabsSync.js`

Responsibilities:

- Config
  - `loadTabsConfig()` → `{ enabled, groupTitle }`
- Cloud model
  - `fetchTabsCloudModel(groupTitle)` → builds structured windows/groups/pinned/ungrouped with indices by parsing `[index]` prefixes
  - Creation helpers: ensure tabs group; create/move/rename collections and items
- Browser model
  - `readBrowserModel()` → windows with pinned, groups, ungrouped, and their indices
- Reconciliation
  - `applyCloudToBrowser(cloud, maps)` → create/move tabs, groups, windows per order rules
  - `mirrorBrowserToCloud(events, maps)` → reflect window/tab/group creation/move/delete, updating titles with prefixes
- Helpers
  - `parseIndexPrefix(title)` and `formatIndexedTitle(index, baseTitle)`
  - URL filtering (only http/https)
  - Suppression guard to avoid feedback loops when applying cloud changes

## Event Mirroring (Browser → Cloud)

- `chrome.windows.onCreated` → create a window root collection
- `chrome.windows.onRemoved` → keep collection (do not auto-delete), optional policy later
- `chrome.tabs.onCreated` → create item in correct collection (`__Pinned__` or group or root)
- `chrome.tabs.onRemoved` → delete corresponding item
- `chrome.tabs.onUpdated` → update title/link; move between `__Pinned__` and root on pin change
- `chrome.tabs.onMoved` → recompute indices for the window and update prefixes for affected children
- `chrome.tabs.onAttached`/`onDetached` → move item between window collections
- `chrome.tabGroups.onCreated` → create child collection (group)
- `chrome.tabGroups.onRemoved` → delete child collection (group) and its items, or move items (TBD policy)
- `chrome.tabGroups.onUpdated` → rename group collection (write prefixes)
- `chrome.tabGroups.onMoved` → recompute window mixed sequence indices

Only recompute and update the window that changed to minimize API calls.

## Conflict Strategy

- Local last-writer wins for immediate event handling; scheduled sync reconciles cloud drift.
- On cloud pull, if both sides changed:
  - Prefer the side with the more recent change timestamp (use Raindrop `lastUpdate` and a local event timestamp for the window).
  - If unavailable, prefer local (to keep the UI responsive).

## Error Handling & Limits

- Skip non-http/https tabs.
- Deduplicate by URL within a window (avoid spawning duplicate tabs locally).
- Rate-limit batch updates to avoid API throttling.
- Ensure the special group via PUT `/user` (update `user.groups`). If that fails (auth/validation), prompt the user to create it manually and retry later.

## Rollout

1. Add "tabGroups" permission to `manifest.json`.
2. Add options: enable toggle and group title.
3. Exclude tabs group from existing bookmark sync paths.
4. Implement `tabsSync.js` with read-only logging (cloud and browser models).
5. Implement cloud → browser apply.
6. Add browser event mirroring.
7. Implement `[index]` prefixes comprehensively for all children within each collection.
8. Handle deletions and movement across windows/groups.
9. Stabilize and QA across multiple windows and devices.

## Open Decisions

- Window close behavior: keep associated collection; optionally tag/archive or auto-prune after inactivity.
- Naming windows: "Window N" vs machine label.
- Group deletion policy: delete vs move items to ungrouped.

---

This design isolates tab syncing from bookmark mirroring while providing a clear, ordered mapping between Raindrop collections/items and live browser windows, groups, and tabs. The index prefix strategy ensures stable, predictable ordering across devices.
