## 🐻‍❄️ Raindrop Bear — keep your bookmarks cozy and in sync

One tiny purpose: sync your Raindrop.io collections and bookmarks into your browser’s bookmarks — across devices. No clutter, no ads, just a tidy `Raindrop` folder in your Bookmarks Bar. Rawr.

### Why you’ll love it

- **Two‑way sync**: cloud ↔ local under a managed `Raindrop` folder
- **Mirrors your structure**: groups become folders, collections become subfolders
- **Auto‑sync every ~10 minutes**: or run a manual sync from the popup
- **Unsorted handled**: items in Raindrop “Unsorted” go to a matching `Unsorted` folder
- **Saved Projects**: save highlighted tabs or your whole window as a named project in Raindrop, then recover it later from the popup
- **Quiet by default**: optional notifications after each sync

### Simple setup

1. Install and open the extension’s Options
2. Paste your Raindrop API token (find it at `https://app.raindrop.io/settings/integrations`)
3. That’s it — your `Raindrop` folder appears in the Bookmarks Bar ✨

### Popup actions

- **Sync now**
- **Save to Unsorted**: send current/highlighted tabs to Raindrop Unsorted
- **Save as Project**: save highlighted tabs or the entire current window under Raindrop → `Saved Projects`
- **Recover a project**: reopen a saved project (restores order and tab groups when available)

### Permissions (what and why)

- **bookmarks**: create/update folders and bookmarks for sync
- **storage** / **unlimitedStorage**: keep lightweight sync state locally
- **notifications**: optional “sync done/failed” messages
- **alarms**: schedule periodic syncs
- **tabs**: used by popup actions to save current/highlighted tabs and to recover Saved Projects into windows
- **Host**: `https://api.raindrop.io/*` only

### Privacy

- Your API token stays **on your device**
- No analytics. No tracking. Just syncing. 💙

### Notes

- Sync is **two‑way** within the managed `Raindrop` folder
- The Raindrop group `Saved Projects` is kept cloud‑only and is not mirrored into local bookmarks
- If you delete the `Raindrop` folder, the next sync will recreate it safely

Need help or want to peek at the code? Visit the project on GitHub.
