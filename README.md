# 🐻‍❄️💧 Raindrop Bear

A tiny helper that does one thing super well: **sync your Raindrop.io bookmarks to your local browser**. No fuss, no feature soup — just your cloud bookmarks, happily living in your bookmarks bar. Rawr! 🐻

## What it does

- **One‑way sync** from Raindrop → your browser’s bookmarks
- Creates a `Raindrop` folder in your Bookmarks Bar, mirroring your groups and collections
- Keeps things fresh automatically every ~10 minutes (you can also click the extension icon to sync now)
- Optional notifications after each sync

## Install

1. Download or clone this repo.
2. Open `chrome://extensions` in Chrome/Brave/Edge (any Chromium browser with MV3).
3. Toggle on Developer mode.
4. Click “Load unpacked” and select this project folder.

## Setup (just once!)

1. Open the extension’s Options.
2. Paste your Raindrop API token.
   - You can find/generate it here: `https://app.raindrop.io/settings/integrations`
3. Save. That’s it — your bookmarks will start syncing into the `Raindrop` folder. ✨

## How sync works

- Runs every ~10 minutes in the background
- Mirrors groups → folders and collections → subfolders
- Adds/updates bookmarks and removes ones you’ve trashed in Raindrop
- Special case: items in Raindrop “Unsorted” go to an `Unsorted` folder under `Raindrop`

## Privacy

- Your API token is stored **locally**.
- Network calls go only to `api.raindrop.io`.
- No analytics. No tracking. Just syncing. 💙

## Notes

- It’s strictly one‑way: changes you make to local bookmarks don’t upload to Raindrop.
- If you uninstall the extension, the `Raindrop` folder stays put (you can delete it manually).

## License

MIT
