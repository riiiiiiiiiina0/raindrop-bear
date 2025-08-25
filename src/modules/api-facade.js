// High-level Raindrop API facade that wraps low-level API calls with
// token loading and user notifications for missing/invalid tokens.
import {
  apiGET as lowGET,
  apiPOST as lowPOST,
  apiPUT as lowPUT,
  apiPUTFile as lowPUTFile,
  apiDELETE as lowDELETE,
  apiGETText as lowGETText,
  uploadCover as lowUploadCover,
  setApiToken as setLowToken,
  loadTokenIfNeeded,
} from './raindrop.js';
import { notifyMissingOrInvalidToken } from './notifications.js';
import { chromeP } from './chrome.js';

let RAINDROP_API_TOKEN = '';

async function ensureToken() {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
  }
  if (!RAINDROP_API_TOKEN) {
    notifyMissingOrInvalidToken(
      'No API token configured. Please add your Raindrop API token.',
    );
    throw new Error('Missing Raindrop API token');
  }
  setLowToken(RAINDROP_API_TOKEN);
  await loadTokenIfNeeded();
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
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

export async function uploadCover(raindropId, dataUrl) {
  try {
    await ensureToken();
    return await lowUploadCover(raindropId, dataUrl);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
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
        'Invalid API token. Please update your Raindrop API token.',
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
        'Invalid API token. Please update your Raindrop API token.',
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
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}

export async function apiPUTFile(path, body) {
  try {
    await ensureToken();
    return await lowPUTFile(path, body);
  } catch (err) {
    if (err && (err.status === 401 || err.status === 403)) {
      notifyMissingOrInvalidToken(
        'Invalid API token. Please update your Raindrop API token.',
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
        'Invalid API token. Please update your Raindrop API token.',
      );
    }
    throw err;
  }
}
