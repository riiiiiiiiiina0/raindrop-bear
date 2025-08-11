# 🐻‍❄️💧 Raindrop Bear

A tiny helper with one cuddly purpose: **sync your Raindrop.io collections and bookmarks into your browser’s bookmarks — across devices**. No fuss, no feature soup. Just your cloud bookmarks, happily living in your Bookmarks Bar. Rawr!

![Poster](./docs/poster.jpeg)

<a href="https://buymeacoffee.com/riiiiiiiiiina" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

---

## 🚀 What’s New (v1.37.0)

* 🌲 **Refined syncing engine:** Smoother, more reliable two-way syncing (cloud <--> local bookmarks bar).
* 🐾 **Custom icon actions:** Choose what single or double-click does—sync, save, open options, or just chill!
* ✨ **Brand new Options UI:** Clean, modern, and super easy to use!
* 💬 **Sync notifications:** Get an optional cute “done!” or “oops!” toast after every sync.
* 🐻‍❄️ **New icon & visuals:** Extra adorable for your toolbar!

---

## Get it

* **Chrome Web Store:** [Raindrop Bear](https://chromewebstore.google.com/detail/raindrop-bear/gkcgbmlbjcdmnifhcmfgkafekaohjcof)

---

## What it does

* **Two-way sync:** Raindrop ↔ your local browser bookmarks (NEW: now supports both directions, not just one-way!)
* Creates a `Raindrop` folder in your Bookmarks Bar, mirroring your groups and collections
* Keeps things fresh automatically every \~10 minutes (or manually by clicking the icon)
* **Customizable click actions:** Set what happens when you single/double-click the toolbar icon (NEW)
* **Optional notifications:** Cute toast after every sync (NEW)
* **Modern Options UI:** For easier setup and customization (NEW)

---

## Install (from source)

1. Download or clone this repo
2. Open `chrome://extensions` in Chrome/Brave/Edge (Chromium browsers, MV3)
3. Toggle on Developer mode
4. Click “Load unpacked” and select this project folder

---

## Setup (just once!)

1. Open the extension Options
2. Paste your Raindrop API token

   * Find/generate: `https://app.raindrop.io/settings/integrations`
3. Save — your bookmarks will start syncing into the `Raindrop` folder ✨

---

## How sync works

* Runs every \~10 minutes in the background
* Mirrors Raindrop groups → top-level folders; collections → subfolders
* Adds/updates bookmarks; removes ones you’ve trashed in Raindrop
* “Unsorted” items go into an `Unsorted` folder under `Raindrop`
* **Now two-way:** Changes sync both ways for full reliability (NEW)
* Strictly edits the `Raindrop` folder—editing other local bookmarks won’t affect your cloud

---

## Permissions & privacy

* **bookmarks**: create/update folders and bookmarks for sync
* **storage** and **unlimitedStorage**: save lightweight sync state locally
* **notifications**: optional “sync done/failed” toasts
* **alarms**: schedule periodic syncs
* **tabs**: optional “Save to Raindrop” action (if you choose it in Options)
* **Host**: `https://api.raindrop.io/*` only

Privacy promise: your API token stays **local**. No analytics. No tracking. Just syncing. 💙

---

## Tips

* Click the extension icon to trigger a manual sync, **or set custom actions in Options** (NEW)
* If you delete the `Raindrop` folder, the next sync will safely recreate it
* Enable or disable sync notifications in Options

---

## License

MIT
**Changelog:**
See [Release v1.37.0](https://github.com/riiiiiiiiiina0/raindrop-bear-v2/releases/tag/v1.37.0) for more details!
