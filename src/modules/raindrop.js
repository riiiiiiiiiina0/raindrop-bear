import { chromeP } from './chrome.js';

const RAINDROP_API_BASE = 'https://api.raindrop.io/rest/v1';
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
 * Loads the Raindrop API token from Chrome storage if it is not already set.
 *
 * @returns {Promise<string>} The Raindrop API token.
 */
export async function loadTokenIfNeeded() {
  if (!RAINDROP_API_TOKEN) {
    try {
      const data = await chromeP.storageGet('raindropApiToken');
      RAINDROP_API_TOKEN =
        data && data.raindropApiToken ? data.raindropApiToken : '';
    } catch (_) {}
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
