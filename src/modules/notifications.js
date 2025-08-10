export const TOKEN_NOTIFICATION_ID = 'raindrop-token-required';
let lastTokenNotificationMs = 0;

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
