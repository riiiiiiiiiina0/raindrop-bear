## Privacy Policy for Raindrop Bear

Last updated: 2025-08-14

Raindrop Bear is a Chrome extension that syncs your Raindrop.io collections and bookmarks into your browser’s bookmarks. This policy explains what data the extension accesses, how it’s used, and your choices. We designed Raindrop Bear to collect the minimum data necessary to provide its features. We do not sell or rent data, and we do not use analytics or advertising trackers.

### What the extension accesses

- **Raindrop account access (via your token)**

  - You provide a Raindrop API token in the extension’s Options. The token is stored locally using `chrome.storage.local` and is used only to call the official Raindrop API over HTTPS (`https://api.raindrop.io/*`).
  - The extension reads your Raindrop metadata (e.g., groups, collections, items) to mirror them into your local bookmarks and to save tabs to Raindrop when you request it.

- **Bookmarks**

  - Reads and writes bookmarks to create and maintain a managed `Raindrop` folder and its subfolders that mirror your Raindrop collections.
  - Reads bookmark tree structure to locate the Bookmarks Bar and manage items within the `Raindrop` folder. It does not modify unrelated bookmarks.

- **Tabs and windows (only when needed for specific features)**

  - Reads the URL, title, pin state, and tab group metadata of your currently active or highlighted tabs when you use actions like “Save to Unsorted,” “Save as Project,” or “Sync current window as project (⏫).”
  - Listens to tab/window events to schedule project syncs for the current window if you’ve enabled that feature. It does not read page content or keystrokes.

- **Notifications and alarms**

  - Shows optional notifications for sync success/failure and to prompt for a missing/invalid token.
  - Uses alarms to run periodic background syncs (default ~10 minutes).

- **Local extension storage**
  - Stores lightweight sync state in `chrome.storage.local`, such as:
    - `lastSync` timestamp
    - Mappings between Raindrop IDs and local bookmark IDs (`collectionMap`, `itemMap`)
    - The managed root folder ID (`rootFolderId`) and group-to-folder map (`groupMap`)
    - Window sync sessions (window → project mapping) when you use ⏫ live sync
    - Preference for showing sync notifications (`notifyOnSync`)

### What the extension does not collect

- No analytics or telemetry.
- No advertising identifiers.
- No sale or sharing of personal information for cross-context behavioral advertising.
- No content scripts; the extension does not read page contents or form inputs.

### How your data is used

- Your Raindrop token is used solely to authenticate requests to the Raindrop API.
- Tab metadata (URL/title/pin/group) is used only when you explicitly trigger actions to save or sync tabs with Raindrop projects.
- Bookmarks data is used to mirror your Raindrop collections into a local `Raindrop` folder and keep it up to date.
- All network communication with Raindrop occurs over HTTPS. The extension has host access only to `https://api.raindrop.io/*`.

### Data sharing and third parties

- The extension communicates only with the Raindrop API to perform the features you invoke. We do not send your data to any other third parties.
- Your local sync state (token, maps, timestamps, preferences) remains on your device within `chrome.storage.local`.

### Data retention and deletion

- Local data (token, sync state, preferences) persists until you remove or reset it. You can:
  - Remove or change your token in the Options page; or
  - Remove the extension (`chrome://extensions` → Remove), which deletes the extension’s local storage.
- Data saved to your Raindrop account is retained by Raindrop per your account settings. To remove that data, delete items/collections in Raindrop or revoke the token in your Raindrop settings.

### Permissions used (as declared in the Chrome Web Store)

- `bookmarks`: Create/update folders and bookmarks under the managed `Raindrop` folder.
- `tabs` and `tabGroups`: Read active/highlighted tab URLs/titles and group info when you use Save/Project features; schedule window-based syncs.
- `storage` and `unlimitedStorage`: Store lightweight sync state and preferences locally.
- `notifications`: Show optional sync and token status notifications.
- `alarms`: Schedule periodic background syncs and window sync throttling.
- Host access: `https://api.raindrop.io/*` only.

### Children’s privacy

Raindrop Bear is not directed to children under 13 and does not knowingly collect personal information from children.

### Your choices

- You may uninstall the extension at any time.
- You may remove or rotate your Raindrop token in the Options page or revoke access from your Raindrop account settings.
- You may disable sync notifications in the Options page.

### Changes to this policy

We may update this policy to reflect improvements or changes. Material changes will be reflected by updating the “Last updated” date above.

### Contact

If you have questions regarding this policy, please contact us via the support link provided on the extension's Chrome Web Store page.

If you open an issue on the project repository, avoid sharing your API token or any sensitive information.
