/**
 * Periodic synchronization for Supabase blacklists
 * Handles bidirectional sync: downloads subscriptions + uploads published list
 */

import { syncSubscriptions, bidirectionalSync } from './sync.js';
import { getPublishedListId, getPublishedEditCode, getEnabledSubscriptions } from './state.js';

const LOG_PREFIX = '[ave-periodic-sync]';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

let syncTimer = null;
let isSyncing = false;

/**
 * Start periodic synchronization
 * Runs every 5 minutes automatically
 */
export function startPeriodicSync() {
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
export function stopPeriodicSync() {
  if (syncTimer) {
    console.log(`${LOG_PREFIX} Stopping periodic sync`);
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

/**
 * Force sync immediately (on-demand)
 * @returns {Promise<{users: number, offers: number}>}
 */
export async function forceSyncNow() {
  console.log(`${LOG_PREFIX} Force sync requested`);
  return await syncAndRefresh();
}

/**
 * Bidirectional sync + refresh page filtering
 * 1. Bidirectional sync for published list (upload/download/merge as needed)
 * 2. Download and merge subscriptions (read-only lists)
 * 3. Refresh: Re-filter current page
 * @returns {Promise<{users: number, offers: number}>}
 */
export async function syncAndRefresh() {
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
 * Triggers re-processing of current search page
 */
async function refreshPageFiltering() {
  try {
    // Check which platform we're on and trigger appropriate re-filter
    const url = window.location.href;

    if (url.includes('/search/catalog')) {
      // Desktop search page
      console.log(`${LOG_PREFIX} Refreshing desktop search page`);

      // Import the processSearchPage function if available
      // Note: This requires the function to be exported from desktop/pages/search.js
      if (typeof window.processSearchPage === 'function') {
        window.processSearchPage();
      } else {
        // Alternative: reload the page (less elegant but works)
        console.log(`${LOG_PREFIX} processSearchPage not available, consider page reload`);
      }
    } else if (url.includes('m.funpay.com')) {
      // Mobile site
      console.log(`${LOG_PREFIX} Refreshing mobile search page`);

      // Mobile uses API interceptor, so data will be re-filtered on next response
      // We can trigger a re-render if the function is exposed
      if (typeof window.processMobileSearchPage === 'function') {
        window.processMobileSearchPage();
      }
    }

    console.log(`${LOG_PREFIX} Page filtering refreshed`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Refresh filtering failed:`, error);
    // Non-critical error, don't throw
  }
}

/**
 * Check if periodic sync is running
 * @returns {boolean}
 */
export function isPeriodicSyncActive() {
  return syncTimer !== null;
}
