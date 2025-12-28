/**
 * Automatic sync trigger with debouncing
 * Syncs changes to remote when local DB is modified
 */

import { bidirectionalSync } from './sync.js';
import { getPublishedListId, getPublishedEditCode } from './state.js';

const LOG_PREFIX = '[ave-auto-sync]';
const DEBOUNCE_DELAY = 2000; // 2 seconds - wait for rapid changes to settle

let debounceTimer = null;
let isSyncing = false;

/**
 * Trigger automatic sync (debounced)
 * Called whenever local DB is modified
 */
export function triggerAutoSync() {
  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Set new timer
  debounceTimer = setTimeout(() => {
    performAutoSync();
  }, DEBOUNCE_DELAY);
}

/**
 * Perform the actual sync operation
 */
async function performAutoSync() {
  if (isSyncing) {
    console.log(`${LOG_PREFIX} Sync already in progress, skipping`);
    return;
  }

  const publishedId = getPublishedListId();
  const publishedEditCode = getPublishedEditCode();

  if (!publishedId || !publishedEditCode) {
    // No published list configured, skip auto-sync
    return;
  }

  isSyncing = true;

  try {
    console.log(`${LOG_PREFIX} Auto-sync triggered...`);
    const result = await bidirectionalSync(publishedId, publishedEditCode);
    console.log(`${LOG_PREFIX} Auto-sync complete: ${result.users} users, ${result.offers} offers`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Auto-sync failed:`, error);
    // Don't throw - auto-sync failures should be silent
  } finally {
    isSyncing = false;
  }
}
