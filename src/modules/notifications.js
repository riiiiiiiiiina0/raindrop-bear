export const TOKEN_NOTIFICATION_ID = 'raindrop-token-required';
let lastTokenNotificationMs = 0;
export const SYNC_SUCCESS_NOTIFICATION_ID = 'raindrop-sync-success';
export const SYNC_FAILURE_NOTIFICATION_ID = 'raindrop-sync-failure';

/**
 * Shows a basic notification to the user with the given message.
 *
 * @param {string} message - The message to display in the notification.
 */
export function notify(message) {
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      '',
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear',
        message: message || '',
        priority: 0,
      },
      () => {},
    );
  } catch (_) {}
}

/**
 * Shows a success notification for a completed sync.
 * @param {string} message
 */
export function notifySyncSuccess(message) {
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      SYNC_SUCCESS_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear',
        message: message || 'Sync completed successfully.',
        priority: 0,
      },
      () => {},
    );
  } catch (_) {}
}

/**
 * Shows a failure notification for a sync error.
 * @param {string} message
 */
export function notifySyncFailure(message) {
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      SYNC_FAILURE_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear: Sync failed',
        message:
          message ||
          'An error occurred during sync. It will retry automatically.',
        priority: 1,
      },
      () => {},
    );
  } catch (_) {}
}

/**
 * Shows a high-priority notification indicating that the Raindrop API token is missing or invalid.
 * Debounces notifications to avoid spamming the user (at most once per 60 seconds).
 *
 * @param {string} [message] - Optional custom message to display. If not provided, a default message is used.
 */
export function notifyMissingOrInvalidToken(message) {
  const now = Date.now();
  if (now - lastTokenNotificationMs < 60000) return; // debounce 60s
  lastTokenNotificationMs = now;
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon-128x128.png');
    chrome.notifications?.create(
      TOKEN_NOTIFICATION_ID,
      {
        type: 'basic',
        iconUrl,
        title: 'Raindrop Bear: Action required',
        message:
          message || 'Please configure your Raindrop API token in Options.',
        priority: 2,
        requireInteraction: true,
      },
      () => {},
    );
  } catch (_) {}
}
