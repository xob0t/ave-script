/**
 * Main content script entry point for AVE Script
 * Runs on avito.ru pages
 */

import { initDB, registerChangeCallback, registerAutoSyncCallback, runMigration, getAllUsers, getAllOffers } from '@/utils/db';
import { initState, setBlacklistUsers, setBlacklistOffers, getEnabledSubscriptions, getPublishedListId, getPublishedEditCode, markLocalChange } from '@/utils/state';
import { initDesktop } from '@/utils/desktop/index';
import { initMobile, installFetchInterceptor } from '@/utils/mobile/index';
import { syncSubscriptions, bidirectionalSync } from '@/utils/sync';
import { startPeriodicSync } from '@/utils/periodic-sync';
import { triggerAutoSync } from '@/utils/auto-sync';
import { addMenuButton } from '@/utils/menu';
import styles from '@/assets/styles.css?inline';

const LOG_PREFIX = '[ave]';

export default defineContentScript({
  matches: ['*://www.avito.ru/*', '*://m.avito.ru/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',

  async main() {
    const isMobile = window.location.hostname === 'm.avito.ru';

    // Install fetch interceptor IMMEDIATELY for mobile (before any API calls)
    if (isMobile) {
      installFetchInterceptor();
    }

    console.log(`${LOG_PREFIX} Script loaded (readyState: ${document.readyState}, platform: ${isMobile ? 'mobile' : 'desktop'})`);

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    (document.head || document.documentElement).appendChild(styleEl);

    async function init() {
      console.log(`${LOG_PREFIX} Initializing AVE Blacklist`);

      // Initialize state from storage
      await initState();

      // Register callbacks for DB changes
      registerChangeCallback(markLocalChange);
      registerAutoSyncCallback(triggerAutoSync);

      try {
        await initDB();
        console.log(`${LOG_PREFIX} IndexedDB initialized`);

        // Run migration for timestamp support (v1 -> v2)
        await runMigration();
        console.log(`${LOG_PREFIX} Migration check complete`);

        // Check for published list (bidirectional sync)
        const publishedId = getPublishedListId();
        const publishedEditCode = getPublishedEditCode();

        if (publishedId && publishedEditCode) {
          console.log(`${LOG_PREFIX} Published list found, starting bidirectional sync...`);

          try {
            // Bidirectional sync for published list
            const syncResult = await bidirectionalSync(publishedId, publishedEditCode);
            console.log(`${LOG_PREFIX} Bidirectional sync complete: ${syncResult.users} users, ${syncResult.offers} offers`);

            // Start periodic sync
            startPeriodicSync();
          } catch (syncError) {
            console.error(`${LOG_PREFIX} Bidirectional sync failed, using local only:`, syncError);
            // Fallback to local list only
            const users = await getAllUsers();
            const offers = await getAllOffers();
            setBlacklistUsers(users);
            setBlacklistOffers(offers);
          }
        } else {
          // No published list - check for subscriptions
          const enabledSubs = getEnabledSubscriptions();

          if (enabledSubs.length > 0) {
            console.log(`${LOG_PREFIX} Found ${enabledSubs.length} enabled subscriptions, syncing...`);

            try {
              // Sync subscriptions (automatically merges with personal list)
              const syncResult = await syncSubscriptions();
              console.log(`${LOG_PREFIX} Sync complete: ${syncResult.users} users, ${syncResult.offers} offers`);

              // Start periodic sync
              startPeriodicSync();
            } catch (syncError) {
              console.error(`${LOG_PREFIX} Sync failed, using personal list only:`, syncError);
              // Fallback to personal list only
              const users = await getAllUsers();
              const offers = await getAllOffers();
              setBlacklistUsers(users);
              setBlacklistOffers(offers);
            }
          } else {
            // No sync enabled, use local only
            console.log(`${LOG_PREFIX} No sync enabled, using local list only`);
            const users = await getAllUsers();
            const offers = await getAllOffers();
            setBlacklistUsers(users);
            setBlacklistOffers(offers);
          }
        }

        console.log(`${LOG_PREFIX} Blacklist loaded`);

        // Add floating menu button
        addMenuButton();

        if (isMobile) {
          await initMobile();
        } else {
          await initDesktop();
        }
      } catch (error) {
        console.error(`${LOG_PREFIX} Error initializing:`, error);
      }
    }

    // Start as early as possible
    if (document.readyState === 'loading') {
      // DOM not ready yet, wait for it
      document.addEventListener('DOMContentLoaded', init);
      console.log(`${LOG_PREFIX} Waiting for DOMContentLoaded...`);
    } else {
      // DOM already ready
      init();
    }

    // Listen for refresh events from periodic sync
    window.addEventListener('ave:refresh-page', () => {
      console.log(`${LOG_PREFIX} Refresh page event received`);
      // Re-process the page after sync
      if (isMobile) {
        import('@/utils/mobile/search').then(m => m.processMobileSearchPage());
      } else {
        import('@/utils/desktop/search').then(m => m.processSearchPage());
      }
    });
  }
});
