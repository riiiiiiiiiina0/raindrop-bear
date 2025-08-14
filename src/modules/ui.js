// Action badge/title and notifications helpers
import {
  notify,
  notifySyncFailure,
  notifySyncSuccess,
  TOKEN_NOTIFICATION_ID,
  SYNC_SUCCESS_NOTIFICATION_ID,
} from './notifications.js';

export function setBadge(text, backgroundColor) {
  try {
    chrome.action?.setBadgeText({ text: text || '' });
    if (backgroundColor) {
      chrome.action?.setBadgeBackgroundColor({ color: backgroundColor });
    }
  } catch (_) {}
}

export function clearBadge() {
  try {
    chrome.action?.setBadgeText({ text: '' });
  } catch (_) {}
}

export function scheduleClearBadge(delayMs) {
  try {
    chrome.alarms.clear('raindrop-clear-badge', () => {
      try {
        chrome.alarms.create('raindrop-clear-badge', {
          when: Date.now() + Math.max(0, delayMs || 0),
        });
      } catch (_) {}
    });
  } catch (_) {}
}

export function setActionTitle(title) {
  try {
    chrome.action?.setTitle({ title: String(title || '') });
  } catch (_) {}
}

export function flashBadge(success) {
  if (success) {
    setBadge('✔️', '#22c55e');
  } else {
    setBadge('😵', '#ef4444');
  }
  scheduleClearBadge(3000);
}

export {
  notify,
  notifySyncFailure,
  notifySyncSuccess,
  TOKEN_NOTIFICATION_ID,
  SYNC_SUCCESS_NOTIFICATION_ID,
};
