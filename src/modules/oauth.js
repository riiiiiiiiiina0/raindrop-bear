/**
 * Example message:
 * {
 *    "type":"oauth_success",
 *    "provider":"raindrop",
 *    "tokens":{
 *      "access_token":"...",
 *      "refresh_token":"...",
 *      "expires":1209599969, //in miliseconds, deprecated
 *      "expires_in":1209599, //in seconds, use this instead!!!
 *      "token_type":"Bearer"
 *    }
 * }
 */

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    console.log(`Received message from URL: ${sender.url}`);
    console.log(`Received message: ${JSON.stringify(message)}`);

    // Handle OAuth success message
    if (
      message &&
      message.type === 'oauth_success' &&
      message.provider === 'raindrop' &&
      message.tokens
    ) {
      const { access_token, refresh_token, expires_in } = message.tokens;

      if (access_token && refresh_token && expires_in) {
        // Convert expires_in (seconds) to absolute timestamp (milliseconds)
        const expiresAt = Date.now() + expires_in * 1000;

        // Store OAuth tokens in sync storage (syncs across devices)
        chrome.storage.sync.set(
          {
            oauthAccessToken: access_token,
            oauthRefreshToken: refresh_token,
            oauthExpiresAt: expiresAt,
          },
          () => {
            console.log(
              'OAuth tokens stored successfully (synced across devices)',
            );
            console.log(
              `Token expires at: ${new Date(expiresAt).toISOString()}`,
            );

            // Notify that OAuth login was successful
            chrome.notifications.create({
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icons/icon-128x128.png'),
              title: 'Raindrop Bear',
              message: '🔐 OAuth login successful! Starting sync...',
            });

            sendResponse({ success: true });
            // Note: Full re-sync is automatically triggered by storage change listener in background.js
          },
        );
      } else {
        console.error('Missing required token fields:', message.tokens);
        sendResponse({ success: false, error: 'Missing token fields' });
      }
    }
  },
);

console.log('OAuth module loaded');
