/**
 * Automatic sync trigger with debouncing
 * Syncs changes to remote when local DB is modified
 */

import { bidirectionalSync } from './sync';
import { getPublishedListId, getPublishedEditCode } from './state';
import { acquireSyncLock, releaseSyncLock } from './sync-lock';

const LOG_PREFIX = '[ave-auto-sync]';
const DEBOUNCE_DELAY = 2000; // 2 seconds - wait for rapid changes to settle

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Trigger automatic sync (debounced)
 * Called whenever local DB is modified
 */
export function triggerAutoSync(): void {
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
async function performAutoSync(): Promise<void> {
  const publishedId = getPublishedListId();
  const publishedEditCode = getPublishedEditCode();

  if (!publishedId || !publishedEditCode) {
    // No published list configured, skip auto-sync
    return;
  }

  if (!acquireSyncLock()) {
    console.log(`${LOG_PREFIX} Sync already in progress, will retry`);
    // Retry after a short delay
    debounceTimer = setTimeout(() => {
      performAutoSync();
    }, 1000);
    return;
  }

  try {
    console.log(`${LOG_PREFIX} Auto-sync triggered...`);
    const result = await bidirectionalSync(publishedId, publishedEditCode);
    console.log(`${LOG_PREFIX} Auto-sync complete: ${result.users} users, ${result.offers} offers`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Auto-sync failed:`, error);
    // Don't throw - auto-sync failures should be silent
  } finally {
    releaseSyncLock();
  }
}
