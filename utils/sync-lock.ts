/**
 * Shared sync lock to prevent concurrent sync operations
 */

let isSyncing = false;

/**
 * Check if a sync operation is currently in progress
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

/**
 * Acquire the sync lock
 * Returns true if lock was acquired, false if already locked
 */
export function acquireSyncLock(): boolean {
  if (isSyncing) {
    return false;
  }
  isSyncing = true;
  return true;
}

/**
 * Release the sync lock
 */
export function releaseSyncLock(): void {
  isSyncing = false;
}
