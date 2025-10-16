// High-level Raindrop API facade that wraps low-level API calls with
// token loading and user notifications for missing/invalid tokens.
import {
  apiGET as lowGET,
  apiPOST as lowPOST,
  apiPUT as lowPUT,
  apiDELETE as lowDELETE,
  apiGETText as lowGETText,
  setApiToken as setLowToken,
  loadTokenIfNeeded,
} from './raindrop.js';
import { notifyMissingOrInvalidToken } from './notifications.js';
import { chromeP } from './chrome.js';

let RAINDROP_API_TOKEN = '';

async function ensureToken() {
  // Load token using the new system that supports both test tokens and OAuth
  const token = await loadTokenIfNeeded();

  if (!token) {
    // Check if there's any form of authentication configured
    const localData = await chromeP.storageGet(['raindropApiToken']);
    const syncData = await chromeP.storageSyncGet([
      'oauthAccessToken',
      'oauthRefreshToken',
    ]);

    const hasTestToken = localData && localData.raindropApiToken;
    const hasOAuth =
      syncData && syncData.oauthAccessToken && syncData.oauthRefreshToken;

    if (!hasTestToken && !hasOAuth) {
      notifyMissingOrInvalidToken(
        'Not logged in yet. Please perform OAuth login or provide a test API token in Settings.',
      );
    } else {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw new Error('Missing Raindrop API token');
  }

  RAINDROP_API_TOKEN = token;
}

export function setFacadeToken(token) {
  RAINDROP_API_TOKEN = token || '';
  setLowToken(RAINDROP_API_TOKEN);
}

export async function apiGET(pathWithQuery) {
  try {
    await ensureToken();
    return await lowGET(pathWithQuery);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw err;
  }
}

export async function apiGETText(pathWithQuery) {
  try {
    await ensureToken();
    return await lowGETText(pathWithQuery);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw err;
  }
}

export async function apiPOST(path, body) {
  try {
    await ensureToken();
    return await lowPOST(path, body);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw err;
  }
}

export async function apiPUT(path, body) {
  try {
    await ensureToken();
    return await lowPUT(path, body);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw err;
  }
}

export async function apiDELETE(path) {
  try {
    await ensureToken();
    return await lowDELETE(path);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid authentication. Please login again or update your API token in Settings.',
      );
    }
    throw err;
  }
}
