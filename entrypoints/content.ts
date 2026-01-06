/**
 * Main content script entry point for AVE Script
 * Runs on avito.ru pages
 */

import { injectScript } from 'wxt/client';
import { initDB, registerChangeCallback, registerAutoSyncCallback, runMigration, getAllUsers, getAllOffers, exportAll, importAll, clearAll } from '@/utils/db';
import { initState, setBlacklistUsers, setBlacklistOffers, getEnabledSubscriptions, getPublishedListId, getPublishedEditCode, markLocalChange, setPaginationEnabled, removeSubscription, toggleSubscription } from '@/utils/state';
import { initDesktop } from '@/utils/desktop/index';
import { initMobile, installFetchInterceptor } from '@/utils/mobile/index';
import { syncSubscriptions, bidirectionalSync, publishToSupabase, subscribeToList, importEditableList } from '@/utils/sync';
import { startPeriodicSync, forceSyncNow } from '@/utils/periodic-sync';
import { triggerAutoSync } from '@/utils/auto-sync';
import { fetchList } from '@/utils/supabase';
import { checkPaginationVisibility } from '@/utils/desktop/pagination';
import styles from '@/assets/styles.css?inline';

const LOG_PREFIX = '[ave]';

export default defineContentScript({
  matches: ['*://www.avito.ru/*', '*://m.avito.ru/*'],
  runAt: 'document_start',
  cssInjectionMode: 'ui',

  async main() {
    const isMobile = window.location.hostname === 'm.avito.ru';

    // Inject main world script IMMEDIATELY for mobile (before any API calls)
    // This intercepts fetch/XHR in the page context
    if (isMobile) {
      injectScript('/injected.js');
      // Also install listener for data from main world
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

    // Listen for messages from popup
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const msg = message as { action: string; data?: unknown };
      console.log(`${LOG_PREFIX} Received message:`, msg.action);

      const handleAsync = async () => {
        try {
          switch (msg.action) {
            case 'getStats': {
              const users = await getAllUsers();
              const offers = await getAllOffers();
              return { users: users.length, offers: offers.length };
            }

            case 'togglePagination': {
              await setPaginationEnabled(msg.data as boolean);
              if (msg.data && !isMobile) {
                checkPaginationVisibility();
              }
              return { success: true };
            }

            case 'publishToSupabase': {
              const { name, description } = msg.data as { name: string; description: string };
              const result = await publishToSupabase(name, description);
              return result;
            }

            case 'importEditableList': {
              const { listId, editCode } = msg.data as { listId: string; editCode: string };
              const result = await importEditableList(listId, editCode);
              await forceSyncNow();
              return result;
            }

            case 'forceSync': {
              const result = await forceSyncNow();
              return result;
            }

            case 'subscribeToList': {
              const { listId } = msg.data as { listId: string };
              const result = await subscribeToList(listId);
              await forceSyncNow();
              return result;
            }

            case 'removeSubscription': {
              const { id } = msg.data as { id: string };
              await removeSubscription(id);
              return { success: true };
            }

            case 'toggleSubscription': {
              const { id } = msg.data as { id: string };
              await toggleSubscription(id);
              return { success: true };
            }

            case 'exportDatabase': {
              const data = await exportAll();
              const serializedData = JSON.stringify(data, null, 2);
              const blob = new Blob([serializedData], { type: 'application/json' });
              const url = URL.createObjectURL(blob);

              const a = document.createElement('a');
              a.href = url;
              a.download = 'avito_blacklist_database.json';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);

              return { success: true };
            }

            case 'importDatabase': {
              const { jsonText } = msg.data as { jsonText: string };
              const data = JSON.parse(jsonText) as { users?: string[]; offers?: string[] };

              if (!data.users && !data.offers) {
                throw new Error('Invalid data format');
              }

              await importAll(data);
              // Mark as changed so next sync will upload imported data
              await markLocalChange();

              const users = await getAllUsers();
              const offers = await getAllOffers();
              setBlacklistUsers(users);
              setBlacklistOffers(offers);

              return { success: true, users: users.length, offers: offers.length };
            }

            case 'clearDatabase': {
              await clearAll();
              // Mark as changed so next sync will clear remote data
              await markLocalChange();
              setBlacklistUsers([]);
              setBlacklistOffers([]);
              return { success: true };
            }

            case 'debugSyncState': {
              console.log('=== AVE SYNC DEBUG STATE ===');

              const localUsers = await getAllUsers();
              const localOffers = await getAllOffers();
              console.log('📦 LOCAL DB:');
              console.log(`  Users: ${localUsers.length}`, localUsers);
              console.log(`  Offers: ${localOffers.length}`, localOffers);

              const publishedId = getPublishedListId();
              const publishedEditCode = getPublishedEditCode();
              console.log('\n📤 PUBLISHED LIST:');
              if (publishedId && publishedEditCode) {
                console.log(`  List ID: ${publishedId}`);
                console.log(`  Edit Code: ${publishedEditCode}`);

                try {
                  const remoteList = await fetchList(publishedId);
                  console.log('\n☁️ REMOTE STATE (Published List):');
                  console.log(`  Name: ${remoteList.name}`);
                  console.log(`  Description: ${remoteList.description}`);
                  console.log(`  Users: ${remoteList.users.length}`, remoteList.users);
                  console.log(`  Offers: ${remoteList.offers.length}`, remoteList.offers);
                  console.log(`  Created: ${remoteList.created_at}`);
                  console.log(`  Updated: ${remoteList.updated_at}`);
                } catch (error) {
                  console.error('  ❌ Failed to fetch remote list:', (error as Error).message);
                }
              } else {
                console.log('  Not published');
              }

              const subs = getEnabledSubscriptions();
              console.log('\n📥 SUBSCRIPTIONS:', subs.length);

              console.log('\n=== END DEBUG STATE ===');

              return { success: true };
            }

            default:
              return { error: 'Unknown action' };
          }
        } catch (error) {
          console.error(`${LOG_PREFIX} Error handling message:`, error);
          return { error: (error as Error).message };
        }
      };

      // Handle async response
      handleAsync().then(sendResponse);
      return true; // Keep the message channel open for async response
    });
  }
});
