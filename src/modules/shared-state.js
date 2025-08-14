// Shared sync state and helpers used across modules

/** Concurrency guard for full sync */
export let isSyncing = false;
export function setIsSyncing(value) {
  isSyncing = Boolean(value);
}

/** Guard to suppress mirroring local bookmark events during extension-initiated changes */
export let suppressLocalBookmarkEvents = false;
export function setSuppressLocalBookmarkEvents(value) {
  suppressLocalBookmarkEvents = Boolean(value);
}

// Track URLs we just created remotely (via bulk save) to prevent mirroring duplicates
export const recentlyCreatedRemoteUrls = new Set();
export function rememberRecentlyCreatedRemoteUrls(urls, ttlMs = 120000) {
  for (const url of urls || []) {
    if (!url) continue;
    const key = String(url);
    recentlyCreatedRemoteUrls.add(key);
    setTimeout(() => {
      try {
        recentlyCreatedRemoteUrls.delete(key);
      } catch (_) {}
    }, Math.max(1000, Number(ttlMs) || 120000));
  }
}
