/**
 * CleanAvito - Userscript entry point
 * Blocks unwanted sellers and listings on Avito
 */

import styles from '../assets/styles.css?inline';
import { triggerAutoSync } from '../utils/auto-sync';
import {
  getAllOffers,
  getAllUsers,
  initDB,
  registerAutoSyncCallback,
  registerChangeCallback,
  runMigration,
} from '../utils/db';
import { initDesktop } from '../utils/desktop/index';
import { initMobile } from '../utils/mobile/index';
import { startPeriodicSync } from '../utils/periodic-sync';
import { bidirectionalSync, syncSubscriptions } from '../utils/sync';
import { registerMenuCommands } from './menu';
import {
  getEnabledSubscriptions,
  getPublishedEditCode,
  getPublishedListId,
  initState,
  markLocalChange,
  setBlacklistOffers,
  setBlacklistUsers,
} from './state';

const LOG_PREFIX = '[ave]';

async function main(): Promise<void> {
  const isMobile = window.location.hostname === 'm.avito.ru';

  console.log(
    `${LOG_PREFIX} Script loaded (readyState: ${document.readyState}, platform: ${isMobile ? 'mobile' : 'desktop'})`,
  );

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  (document.head || document.documentElement).appendChild(styleEl);

  // Register menu commands
  registerMenuCommands();

  async function init(): Promise<void> {
    console.log(`${LOG_PREFIX} Initializing AVE Blacklist`);

    // Initialize IndexedDB
    await initDB();
    console.log(`${LOG_PREFIX} Database initialized`);

    // Run migrations
    await runMigration();

    // Initialize state from GM storage
    initState();
    console.log(`${LOG_PREFIX} State initialized`);

    // Register callbacks for DB changes
    registerChangeCallback(async () => {
      const users = await getAllUsers();
      const offers = await getAllOffers();
      setBlacklistUsers(users);
      setBlacklistOffers(offers);
    });

    // Register auto-sync callback
    registerAutoSyncCallback(() => {
      markLocalChange();
      triggerAutoSync();
    });

    // Load blacklist data
    const users = await getAllUsers();
    const offers = await getAllOffers();
    setBlacklistUsers(users);
    setBlacklistOffers(offers);

    console.log(`${LOG_PREFIX} Blacklist loaded`);

    if (isMobile) {
      await initMobile();
    } else {
      await initDesktop();
    }

    // Initial sync
    const publishedId = getPublishedListId();
    const publishedEditCode = getPublishedEditCode();

    if (publishedId && publishedEditCode) {
      console.log(`${LOG_PREFIX} Starting initial bidirectional sync...`);
      try {
        await bidirectionalSync(publishedId, publishedEditCode);
      } catch (error) {
        console.error(`${LOG_PREFIX} Initial sync failed:`, error);
      }
    }

    const enabledSubs = getEnabledSubscriptions();
    if (enabledSubs.length > 0) {
      console.log(`${LOG_PREFIX} Syncing ${enabledSubs.length} subscriptions...`);
      try {
        const result = await syncSubscriptions();
        console.log(`${LOG_PREFIX} Subscription sync complete: ${result.users} users, ${result.offers} offers`);
      } catch (error) {
        console.error(`${LOG_PREFIX} Subscription sync failed:`, error);
      }
    }

    // Start periodic sync
    startPeriodicSync();

    console.log(`${LOG_PREFIX} Initialization complete`);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(console.error);
    });
  } else {
    await init();
  }
}

// Run the script
main().catch(console.error);
