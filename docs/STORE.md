## 🐻‍❄️ Raindrop Bear — keep your bookmarks cozy and in sync

One tiny purpose: sync your Raindrop.io collections and bookmarks into your browser’s bookmarks — across devices. No clutter, no ads, just a tidy Raindrop folder in your Bookmarks Bar. Rawr.

Why you'll love it

🌩️ One‑way sync: mirrors cloud → local under a managed Raindrop folder  
🗂️ Mirrors your structure: groups become folders, collections become subfolders  
⏰ Auto‑sync every ~10 minutes: or run a manual sync from the popup  
📁 Choose parent folder: place the Raindrop folder wherever you like (Bookmarks Bar by default)  
📂 Unsorted handled: items in Raindrop "Unsorted" go to a matching Unsorted folder  
💾 Projects: save highlighted tabs as a named project in Raindrop, then recover it later from the popup
⏫ Live window sync: keep a Raindrop project in sync with your current window's tabs until you stop it  
✏️ Rename tabs: give any tab a custom title that persists across reloads and browser restarts (Alt+T)  
🔕 Quiet by default: optional notifications after each sync

Simple setup

1. Install and open the extension’s Options
2. Paste your Raindrop API token (find it at https://app.raindrop.io/settings/integrations)
3. That’s it — your Raindrop folder appears where you chose (Bookmarks Bar by default)

Popup actions

🔄 Sync now
📥 Save to Unsorted: send current/highlighted tabs to Raindrop Unsorted
💾 Save as Project: save highlighted tabs under Raindrop → 🐻‍❄️ Projects
⏫ Sync current window as project: start live syncing the current window to a project (stop by closing the window)
✏️ Rename current tab: give the active tab a custom title (keyboard shortcut: Alt+T). Custom titles persist through reloads, browser restarts, and are saved/restored with projects
♻️ Recover/Delete a project: reopen a saved project (restores order and tab groups when available) or delete it from the popup

Permissions (what and why)

- bookmarks: create/update folders and bookmarks for sync
- storage / unlimitedStorage: keep lightweight sync state and custom tab titles locally
- notifications: optional "sync done/failed" messages
- alarms: schedule periodic syncs
- tabs: used by popup actions to save current/highlighted tabs, recover Projects into windows, and manage custom tab titles
- scripting / activeTab: inject content scripts to enable custom tab title persistence
- Host: https://api.raindrop.io/* for API access; <all_urls> for tab renaming on any site

Privacy

- Your API token stays on your device
- No analytics. No tracking. Just syncing.

Notes

- Sync is one‑way (Raindrop → local) within the managed Raindrop folder
- The Raindrop group 🐻‍❄️ Projects is kept cloud‑only and is not mirrored into local bookmarks
- If you delete the Raindrop folder, the next sync will recreate it safely

Need help or want to peek at the code? Visit the project on GitHub.
