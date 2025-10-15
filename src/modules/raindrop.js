import { chromeP } from './chrome.js';
import { sleep } from './utils.js';

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

async function fetchWithRetry(url, options) {
  let retries = 0;
  while (true) {
    const res = await fetch(url, options);
    if (res.status !== 429 || retries >= MAX_RETRIES) {
      return res;
    }

    const backoffMs = INITIAL_BACKOFF_MS * 2 ** retries;
    console.log(`Raindrop API rate limited. Retrying in ${backoffMs}ms...`);
    await sleep(backoffMs);
    retries++;
  }
}

const RAINDROP_API_BASE = 'https://api.raindrop.io/rest/v1';
const OAUTH_REFRESH_URL = 'https://ohauth.vercel.app/oauth/raindrop/refresh';
const TOKEN_EXPIRY_BUFFER_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

let RAINDROP_API_TOKEN = '';

/**
 * Sets the Raindrop API token to be used for authentication.
 *
 * @param {string} token - The Raindrop API token.
 */
export function setApiToken(token) {
  RAINDROP_API_TOKEN = token || '';
}

/**
 * Checks if OAuth token is expiring soon (within 10 minutes).
 *
 * @param {number} expiresAt - Token expiry timestamp in milliseconds.
 * @returns {boolean} True if token is expiring soon or already expired.
 */
function isOAuthTokenExpiringSoon(expiresAt) {
  if (!expiresAt) return true;
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= expiresAt;
}

/**
 * Refreshes the OAuth access token using the refresh token.
 *
 * @param {string} refreshToken - The OAuth refresh token.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}|null>} New tokens or null on failure.
 */
async function refreshOAuthToken(refreshToken) {
  try {
    console.log('Refreshing OAuth token...');
    const response = await fetch(OAUTH_REFRESH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      console.error('Failed to refresh OAuth token:', response.status);
      return null;
    }

    const data = await response.json();
    if (data.access_token && data.refresh_token && data.expires_in) {
      // Store new tokens in sync storage (syncs across devices)
      const expiresAt = Date.now() + data.expires_in * 1000;
      await chromeP.storageSyncSet({
        oauthAccessToken: data.access_token,
        oauthRefreshToken: data.refresh_token,
        oauthExpiresAt: expiresAt,
      });
      console.log('OAuth token refreshed successfully');
      console.log(`New token expires at: ${new Date(expiresAt).toISOString()}`);
      return data;
    }

    return null;
  } catch (error) {
    console.error('Error refreshing OAuth token:', error);
    return null;
  }
}

/**
 * Gets the active token, preferring test token over OAuth token.
 * Refreshes OAuth token if it's expiring soon.
 *
 * @returns {Promise<string>} The active API token.
 */
async function getActiveToken() {
  try {
    // Get test token from local storage
    const localData = await chromeP.storageGet(['raindropApiToken']);
    
    // Get OAuth tokens from sync storage
    const syncData = await chromeP.storageSyncGet([
      'oauthAccessToken',
      'oauthRefreshToken',
      'oauthExpiresAt',
    ]);

    // Priority 1: Test API token (if present and not empty)
    if (localData && localData.raindropApiToken && localData.raindropApiToken.trim()) {
      return localData.raindropApiToken.trim();
    }

    // Priority 2: OAuth token (with refresh if expiring)
    if (syncData && syncData.oauthAccessToken && syncData.oauthRefreshToken) {
      // Check if token is expiring soon
      if (isOAuthTokenExpiringSoon(syncData.oauthExpiresAt)) {
        console.log('OAuth token expiring soon, attempting refresh...');
        const refreshed = await refreshOAuthToken(syncData.oauthRefreshToken);
        if (refreshed && refreshed.access_token) {
          return refreshed.access_token;
        } else {
          // Refresh failed, try using existing token anyway
          console.warn('Token refresh failed, using existing token');
          return syncData.oauthAccessToken;
        }
      }
      return syncData.oauthAccessToken;
    }

    return '';
  } catch (error) {
    console.error('Error getting active token:', error);
    return '';
  }
}

/**
 * Ensures a valid token is loaded and cached.
 *
 * @returns {Promise<string>} The active API token.
 */
async function ensureValidToken() {
  RAINDROP_API_TOKEN = await getActiveToken();
  return RAINDROP_API_TOKEN;
}

/**
 * Loads the Raindrop API token from Chrome storage if it is not already set.
 * Now uses the new token priority system (test token > OAuth token).
 *
 * @returns {Promise<string>} The Raindrop API token.
 */
export async function loadTokenIfNeeded() {
  if (!RAINDROP_API_TOKEN) {
    await ensureValidToken();
  }
  return RAINDROP_API_TOKEN;
}

/**
 * Performs a GET request to the Raindrop API with the given path and query.
 *
 * @param {string} pathWithQuery - The API path and query string (e.g., "/collections?perpage=50").
 * @returns {Promise<any>} The parsed JSON response from the Raindrop API.
 * @throws {Error} If the API response is not OK, throws an error with status and statusText.
 */
export async function apiGET(pathWithQuery) {
  const url = `${RAINDROP_API_BASE}${
    pathWithQuery.startsWith('/') ? '' : '/'
  }${pathWithQuery}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${pathWithQuery}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  return res.json();
}

/**
 * Performs a GET request and returns raw text (no JSON parsing).
 * Useful for endpoints like export.html that return text/html.
 *
 * @param {string} pathWithQuery
 * @returns {Promise<string>} Response body as text
 * @throws {Error} If the API response is not OK
 */
export async function apiGETText(pathWithQuery) {
  const url = `${RAINDROP_API_BASE}${
    pathWithQuery.startsWith('/') ? '' : '/'
  }${pathWithQuery}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${pathWithQuery}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  return res.text();
}

/**
 * Performs a POST request to the Raindrop API with the given path and JSON body.
 *
 * @param {string} path - The API path (with or without leading slash), e.g. "/raindrop".
 * @param {any} body - The request body which will be JSON.stringify'ed.
 * @returns {Promise<any>} The parsed JSON response from the Raindrop API.
 * @throws {Error} If the API response is not OK, throws an error with status and statusText.
 */
export async function apiPOST(path, body) {
  const url = `${RAINDROP_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${path}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  return res.json();
}

/**
 * Performs a PUT request to the Raindrop API with the given path and JSON body.
 *
 * @param {string} path - The API path (with or without leading slash), e.g. "/raindrop/{id}".
 * @param {any} body - The request body which will be JSON.stringify'ed.
 * @returns {Promise<any>} The parsed JSON response from the Raindrop API.
 * @throws {Error} If the API response is not OK, throws an error with status and statusText.
 */
export async function apiPUT(path, body) {
  const url = `${RAINDROP_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${path}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  return res.json();
}

/**
 * Performs a DELETE request to the Raindrop API with the given path.
 *
 * @param {string} path - The API path (with or without leading slash), e.g. "/raindrop/{id}".
 * @returns {Promise<any>} The parsed JSON response from the Raindrop API.
 * @throws {Error} If the API response is not OK, throws an error with status and statusText.
 */
export async function apiDELETE(path) {
  const url = `${RAINDROP_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${path}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  // Some DELETE endpoints return JSON {result:true}, some may be empty. Try json, else return {}.
  try {
    return await res.json();
  } catch (_) {
    return {};
  }
}

/**
 * Performs a DELETE request to the Raindrop API with the given path and JSON body.
 *
 * @param {string} path - The API path (with or without leading slash), e.g. "/raindrop/{id}".
 * @param {any} body - The request body which will be JSON.stringify'ed.
 * @returns {Promise<any>} The parsed JSON response from the Raindrop API.
 * @throws {Error} If the API response is not OK, throws an error with status and statusText.
 */
export async function apiDELETEWithBody(path, body) {
  const url = `${RAINDROP_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  await loadTokenIfNeeded();
  const res = await fetchWithRetry(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${RAINDROP_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `Raindrop API error ${res.status} for ${path}: ${text}`,
    );
    err['status'] = res.status;
    err['statusText'] = res.statusText;
    throw err;
  }
  // Some DELETE endpoints return JSON {result:true}, some may be empty. Try json, else return {}.
  try {
    return await res.json();
  } catch (_) {
    return {};
  }
}
