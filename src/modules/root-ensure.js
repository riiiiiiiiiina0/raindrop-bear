import { getOrCreateRootFolder } from './bookmarks.js';
import { loadState, saveState } from './state.js';

export async function ensureRootAndMaybeReset() {
  const originalState = await loadState();
  const originalRootId = originalState.rootFolderId;

  // `getOrCreateRootFolder` now contains all the logic for finding, creating,
  // or cleaning up and re-creating the root folder. It will also modify
  // the state (e.g., clearing lastSync) if duplicates are found and removed.
  const newRootId = await getOrCreateRootFolder(loadState, saveState);

  const didReset = !originalRootId || originalRootId !== newRootId;

  // Load the state again, as it might have been modified by getOrCreateRootFolder
  const finalState = await loadState();

  return {
    didReset,
    rootFolderId: newRootId,
    state: finalState,
  };
}
