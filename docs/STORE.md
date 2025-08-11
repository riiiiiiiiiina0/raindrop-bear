## 🐻‍❄️ Raindrop Bear — keep your bookmarks cozy and in sync

One tiny purpose: sync your Raindrop.io collections and bookmarks into your browser’s bookmarks — across devices. No clutter, no ads, just a tidy `Raindrop` folder in your Bookmarks Bar. Rawr.

### Why you’ll love it

- **One‑way sync (cloud → local)**: your Raindrop stays the source of truth
- **Mirrors your structure**: groups become folders, collections become subfolders
- **Auto‑sync every ~10 minutes**: or click the icon to sync instantly
- **Unsorted handled**: items in Raindrop “Unsorted” go to a matching `Unsorted` folder
- **Quiet by default**: optional notifications after each sync

### Simple setup

1. Install and open the extension’s Options
2. Paste your Raindrop API token (find it at `https://app.raindrop.io/settings/integrations`)
3. That’s it — your `Raindrop` folder appears in the Bookmarks Bar ✨

### Optional: icon click behavior

- Default: “Sync now”
- Or choose: “Save to Raindrop” (sends current/highlighted tabs to Raindrop Unsorted), “Open Options”, or “Do nothing”

### Permissions (what and why)

- **bookmarks**: create/update folders and bookmarks for sync
- **storage** / **unlimitedStorage**: keep lightweight sync state locally
- **notifications**: optional “sync done/failed” messages
- **alarms**: schedule periodic syncs
- **tabs**: only used if you pick “Save to Raindrop” for the icon click
- **Host**: `https://api.raindrop.io/*` only

### Privacy

- Your API token stays **on your device**
- No analytics. No tracking. Just syncing. 💙

### Notes

- This is a **one‑way** sync (Raindrop → browser). Editing local bookmarks won’t change Raindrop
- If you delete the `Raindrop` folder, the next sync will recreate it safely

Need help or want to peek at the code? Visit the project on GitHub.
