/**
 * Periodic synchronization for Supabase blacklists
 * Handles bidirectional sync: downloads subscriptions + uploads published list
 */

import { syncSubscriptions, bidirectionalSync } from './sync';
import { getPublishedListId, getPublishedEditCode, getEnabledSubscriptions } from './state';

const LOG_PREFIX = '[ave-periodic-sync]';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

let syncTimer: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

/**
 * Start periodic synchronization
 * Runs every 5 minutes automatically
 */
export function startPeriodicSync(): void {
  if (syncTimer) {
    console.log(`${LOG_PREFIX} Already running`);
    return;
  }

  console.log(`${LOG_PREFIX} Starting periodic sync (interval: ${SYNC_INTERVAL / 1000}s)`);

  // Run immediately on start
  syncAndRefresh().catch(error => {
    console.error(`${LOG_PREFIX} Initial sync failed:`, error);
  });

  // Set up interval timer
  syncTimer = setInterval(() => {
    syncAndRefresh().catch(error => {
      console.error(`${LOG_PREFIX} Periodic sync failed:`, error);
    });
  }, SYNC_INTERVAL);
}

/**
 * Stop periodic synchronization
 */
export function stopPeriodicSync(): void {
  if (syncTimer) {
    console.log(`${LOG_PREFIX} Stopping periodic sync`);
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

/**
 * Force sync immediately (on-demand)
 */
export async function forceSyncNow(): Promise<{ users: number; offers: number }> {
  console.log(`${LOG_PREFIX} Force sync requested`);
  return await syncAndRefresh();
}

/**
 * Bidirectional sync + refresh page filtering
 */
export async function syncAndRefresh(): Promise<{ users: number; offers: number }> {
  if (isSyncing) {
    console.log(`${LOG_PREFIX} Sync already in progress, skipping`);
    return { users: 0, offers: 0 };
  }

  isSyncing = true;

  try {
    console.log(`${LOG_PREFIX} Starting periodic sync...`);

    // STEP 1: Bidirectional sync for published list
    const publishedId = getPublishedListId();
    const publishedEditCode = getPublishedEditCode();

    if (publishedId && publishedEditCode) {
      try {
        console.log(`${LOG_PREFIX} Running bidirectional sync...`);
        await bidirectionalSync(publishedId, publishedEditCode);
      } catch (syncError) {
        console.error(`${LOG_PREFIX} Bidirectional sync failed:`, syncError);
        // Continue with subscriptions even if bidirectional sync fails
      }
    }

    // STEP 2: Download and merge subscriptions (read-only lists)
    const enabledSubs = getEnabledSubscriptions();

    if (enabledSubs.length > 0) {
      const result = await syncSubscriptions();
      console.log(`${LOG_PREFIX} Subscription sync complete: ${result.users} users, ${result.offers} offers`);

      // STEP 3: Refresh page filtering
      await refreshPageFiltering();

      return result;
    } else {
      console.log(`${LOG_PREFIX} No subscriptions to sync`);
      return { users: 0, offers: 0 };
    }
  } finally {
    isSyncing = false;
  }
}

/**
 * Refresh page filtering after sync
 */
async function refreshPageFiltering(): Promise<void> {
  try {
    const url = window.location.href;

    if (url.includes('/search/catalog')) {
      console.log(`${LOG_PREFIX} Refreshing desktop search page`);
      // Dispatch custom event for the content script to handle
      window.dispatchEvent(new CustomEvent('ave:refresh-page'));
    } else if (url.includes('m.avito.ru')) {
      console.log(`${LOG_PREFIX} Refreshing mobile search page`);
      window.dispatchEvent(new CustomEvent('ave:refresh-page'));
    }

    console.log(`${LOG_PREFIX} Page filtering refreshed`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Refresh filtering failed:`, error);
  }
}

/**
 * Check if periodic sync is running
 */
export function isPeriodicSyncActive(): boolean {
  return syncTimer !== null;
}
