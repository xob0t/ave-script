import styles from './ui/styles.css';
import { registerMenuCommands } from './ui/menu.js';
import { initDB, getAllUsers, getAllOffers } from './core/db.js';
import { setBlacklistUsers, setBlacklistOffers, getEnabledSubscriptions, getPublishedListId, getPublishedEditCode } from './core/state.js';
import { initDesktop } from './desktop/index.js';
import { initMobile } from './mobile/index.js';
import { installFetchInterceptor } from './mobile/api-interceptor.js';
import { syncSubscriptions, bidirectionalSync } from './core/sync.js';
import { startPeriodicSync } from './core/periodic-sync.js';

const LOG_PREFIX = '[ave]';
const isMobile = window.location.hostname === 'm.avito.ru';

// Install fetch interceptor IMMEDIATELY for mobile (before any API calls)
if (isMobile) {
  installFetchInterceptor();
}

console.log(`${LOG_PREFIX} Script loaded (readyState: ${document.readyState}, platform: ${isMobile ? 'mobile' : 'desktop'})`);

async function init() {
  console.log(`${LOG_PREFIX} Initializing AVE Blacklist v${__VERSION__}`);

  // Inject styles and register menu commands
  GM_addStyle(styles);
  registerMenuCommands();

  try {
    await initDB();
    console.log(`${LOG_PREFIX} IndexedDB initialized`);

    // Run migration for timestamp support (v1 -> v2)
    await initDB.runMigration();
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
