import { exportAll, importAll, getAllUsers, getAllOffers, getAllUsersWithTimestamps, getAllOffersWithTimestamps, clearAllUsers, clearAllOffers, addUserWithTimestamp, addOfferWithTimestamp } from './db.js';
import {
  setBlacklistUsers,
  setBlacklistOffers,
  getPublishedListId,
  getPublishedEditCode,
  setPublishedList,
  getEnabledSubscriptions,
  addSubscription,
  updateSubscriptionLastSynced,
  mergeBlacklists,
  getLastLocalChange,
  getLastSuccessfulSync,
  markSuccessfulSync
} from './state.js';
import {
  createList,
  fetchList,
  fetchLists,
  updateList
} from './supabase.js';

const LOG_PREFIX = '[ave-sync]';

// ==================== Bidirectional Sync Functions ====================

/**
 * Merge two lists (local and remote) using union strategy
 * @param {Array<{id: string, addedAt: number}>} local - Local entries with timestamps
 * @param {Array<{id: string, addedAt: number}>} remote - Remote entries with timestamps
 * @returns {Array<{id: string, addedAt: number}>}
 */
function mergeLists(local, remote) {
  const merged = new Map();

  // Add remote entries first (remote is authoritative for timestamps)
  for (const entry of remote) {
    merged.set(entry.id, entry.addedAt);
  }

  // Add local entries not in remote
  for (const entry of local) {
    if (!merged.has(entry.id)) {
      merged.set(entry.id, entry.addedAt);
    }
  }

  return Array.from(merged.entries()).map(([id, addedAt]) => ({id, addedAt}));
}

/**
 * Update local DB with timestamped entries
 * @param {Array<{id: string, addedAt: number}>} users
 * @param {Array<{id: string, addedAt: number}>} offers
 */
async function updateLocalDB(users, offers) {
  await clearAllUsers();
  await clearAllOffers();

  for (const entry of users) {
    await addUserWithTimestamp(entry.id, entry.addedAt);
  }

  for (const entry of offers) {
    await addOfferWithTimestamp(entry.id, entry.addedAt);
  }
}

/**
 * Bidirectional sync - intelligently upload, download, or merge based on what changed
 * @param {string} listId - List UUID
 * @param {string} editCode - Edit code for write access
 * @returns {Promise<{users: number, offers: number}>}
 */
export async function bidirectionalSync(listId, editCode) {
  try {
    console.log(`${LOG_PREFIX} Bidirectional sync starting...`);

    // Fetch remote state
    const remote = await fetchList(listId);
    const remoteUsers = remote.users || [];
    const remoteOffers = remote.offers || [];
    const remoteUpdatedAt = new Date(remote.updated_at).getTime();

    // Normalize remote data format (handle old format: string[] vs new format: {id, addedAt}[])
    const normalizedRemoteUsers = remoteUsers.map(u =>
      typeof u === 'string' ? {id: u, addedAt: Date.now()} : u
    );
    const normalizedRemoteOffers = remoteOffers.map(o =>
      typeof o === 'string' ? {id: o, addedAt: Date.now()} : o
    );

    // Fetch local state
    const localUsers = await getAllUsersWithTimestamps();
    const localOffers = await getAllOffersWithTimestamps();
    const lastSync = getLastSuccessfulSync();
    const lastLocalChange = getLastLocalChange();

    // Decide sync direction
    const remoteChanged = !lastSync || remoteUpdatedAt > lastSync;
    const localChanged = lastLocalChange && lastLocalChange > lastSync;

    let finalUsers, finalOffers;

    if (remoteChanged && localChanged) {
      // CONFLICT: Both changed - merge
      console.log(`${LOG_PREFIX} Both changed, merging...`);
      finalUsers = mergeLists(localUsers, normalizedRemoteUsers);
      finalOffers = mergeLists(localOffers, normalizedRemoteOffers);
      await updateLocalDB(finalUsers, finalOffers);
      await updateList(listId, editCode, {
        users: finalUsers,
        offers: finalOffers
      });
      markSuccessfulSync(); // Mark sync after actual sync operation
    } else if (remoteChanged) {
      // DOWNLOAD: Remote changed
      console.log(`${LOG_PREFIX} Remote changed, downloading...`);
      finalUsers = normalizedRemoteUsers;
      finalOffers = normalizedRemoteOffers;
      await updateLocalDB(finalUsers, finalOffers);
      markSuccessfulSync(); // Mark sync after download
    } else if (localChanged) {
      // UPLOAD: Local changed
      console.log(`${LOG_PREFIX} Local changed, uploading...`);
      finalUsers = localUsers;
      finalOffers = localOffers;
      await updateList(listId, editCode, {
        users: finalUsers,
        offers: finalOffers
      });
      markSuccessfulSync(); // Mark sync after upload
    } else {
      // NO CHANGE - don't update sync timestamp!
      console.log(`${LOG_PREFIX} No changes detected`);
      finalUsers = localUsers;
      finalOffers = localOffers;
      // DO NOT call markSuccessfulSync() here - we didn't actually sync anything
    }

    // Update in-memory state
    setBlacklistUsers(finalUsers.map(e => e.id));
    setBlacklistOffers(finalOffers.map(e => e.id));

    console.log(`${LOG_PREFIX} Bidirectional sync complete: ${finalUsers.length} users, ${finalOffers.length} offers`);

    return {
      users: finalUsers.length,
      offers: finalOffers.length
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Bidirectional sync error:`, error);
    throw new Error(`Bidirectional sync failed: ${error.message}`);
  }
}

// ==================== Supabase Sync Functions ====================

/**
 * Publish personal blacklist to Supabase
 * Creates new list or updates existing if already published
 * @param {string} name - List name
 * @param {string} description - List description
 * @returns {Promise<{id: string, editCode: string, isNew: boolean}>}
 */
export async function publishToSupabase(name, description = '') {
  try {
    console.log(`${LOG_PREFIX} Publishing to Supabase...`);

    // Export personal blacklist from IndexedDB
    const data = await exportAll();
    const users = data.users || [];
    const offers = data.offers || [];

    // Check if already published (update existing)
    const existingId = getPublishedListId();
    const existingEditCode = getPublishedEditCode();

    if (existingId && existingEditCode) {
      console.log(`${LOG_PREFIX} Updating existing list ${existingId}`);

      const result = await updateList(existingId, existingEditCode, {
        users,
        offers,
        name,
        description
      });

      if (!result.success) {
        throw new Error(result.error || 'Update failed');
      }

      return {
        id: existingId,
        editCode: existingEditCode,
        isNew: false
      };
    }

    // Create new list
    console.log(`${LOG_PREFIX} Creating new list`);
    const { id, editCode } = await createList({
      name,
      description,
      users,
      offers
    });

    // Save credentials locally
    setPublishedList(id, editCode);

    console.log(`${LOG_PREFIX} Published successfully: ${id}`);

    return {
      id,
      editCode,
      isNew: true
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Publish error:`, error);
    throw new Error(`Не удалось опубликовать список: ${error.message}`);
  }
}

/**
 * Sync subscriptions from Supabase and merge with personal blacklist
 * Updates in-memory state with merged data
 * @returns {Promise<{users: number, offers: number}>}
 */
export async function syncSubscriptions() {
  try {
    const enabledSubs = getEnabledSubscriptions();

    if (enabledSubs.length === 0) {
      console.log(`${LOG_PREFIX} No enabled subscriptions to sync`);
      return { users: 0, offers: 0 };
    }

    console.log(`${LOG_PREFIX} Syncing ${enabledSubs.length} subscriptions...`);

    // Fetch all enabled subscription lists
    const listIds = enabledSubs.map(sub => sub.id);
    const subscriptionData = await fetchLists(listIds);

    // Update last synced timestamps
    const now = Date.now();
    for (const sub of enabledSubs) {
      updateSubscriptionLastSynced(sub.id, now);
    }

    // Get personal blacklist
    const personalUsers = await getAllUsers();
    const personalOffers = await getAllOffers();

    // Merge personal + subscriptions
    const merged = mergeBlacklists(
      { users: personalUsers, offers: personalOffers },
      subscriptionData
    );

    // Update in-memory state
    setBlacklistUsers(Array.from(merged.users));
    setBlacklistOffers(Array.from(merged.offers));

    console.log(`${LOG_PREFIX} Sync complete: ${merged.users.size} users, ${merged.offers.size} offers`);

    return {
      users: merged.users.size,
      offers: merged.offers.size
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Sync error:`, error);
    throw new Error(`Ошибка синхронизации: ${error.message}`);
  }
}

/**
 * Subscribe to a read-only Supabase list
 * @param {string} listId - List UUID
 * @returns {Promise<{name: string, description: string, users: number, offers: number}>}
 */
export async function subscribeToList(listId) {
  try {
    console.log(`${LOG_PREFIX} Subscribing to list ${listId}...`);

    // Fetch list metadata
    const list = await fetchList(listId);

    // Add to subscriptions
    addSubscription(listId, list.name);

    console.log(`${LOG_PREFIX} Subscribed to "${list.name}"`);

    return {
      name: list.name,
      description: list.description,
      users: list.users.length,
      offers: list.offers.length
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Subscribe error:`, error);
    throw new Error(`Не удалось подписаться: ${error.message}`);
  }
}

/**
 * Import editable list (for multi-browser sync or shared editing)
 * Links to existing Supabase list with edit permissions
 * @param {string} listId - List UUID
 * @param {string} editCode - Edit code for write access
 * @returns {Promise<{name: string, description: string, users: number, offers: number}>}
 */
export async function importEditableList(listId, editCode) {
  try {
    console.log(`${LOG_PREFIX} Importing editable list ${listId}...`);

    // Fetch list to verify it exists
    const list = await fetchList(listId);

    // Set as user's published list (grants write access)
    setPublishedList(listId, editCode);

    console.log(`${LOG_PREFIX} Linked to editable list "${list.name}"`);

    return {
      name: list.name,
      description: list.description,
      users: list.users.length,
      offers: list.offers.length
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Import editable list error:`, error);
    throw new Error(`Не удалось подключиться к списку: ${error.message}`);
  }
}
