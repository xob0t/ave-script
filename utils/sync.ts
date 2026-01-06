/**
 * Sync operations for Supabase blacklists
 */

import {
  exportAll,
  getAllUsers,
  getAllOffers,
  getAllUsersWithTimestamps,
  getAllOffersWithTimestamps,
  clearAllUsers,
  clearAllOffers,
  addUserWithTimestamp,
  addOfferWithTimestamp,
  type DBEntry
} from './db';
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
} from './state';
import {
  createList,
  fetchList,
  fetchLists,
  updateList,
  type BlacklistEntry
} from './supabase';

const LOG_PREFIX = '[ave-sync]';

// ==================== Bidirectional Sync Functions ====================

/**
 * Merge two lists - local wins (local deletions and additions are preserved)
 */
function mergeLists(local: DBEntry[], remote: BlacklistEntry[]): DBEntry[] {
  const merged = new Map<string, number>();

  // Add local entries first (local is authoritative)
  for (const entry of local) {
    merged.set(entry.id, entry.addedAt);
  }

  // Add remote entries that don't exist in local (new additions from other device)
  for (const entry of remote) {
    if (!merged.has(entry.id)) {
      merged.set(entry.id, entry.addedAt);
    }
  }

  return Array.from(merged.entries()).map(([id, addedAt]) => ({ id, addedAt }));
}

/**
 * Update local DB with timestamped entries
 */
async function updateLocalDB(users: DBEntry[], offers: DBEntry[]): Promise<void> {
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
 */
export async function bidirectionalSync(
  listId: string,
  editCode: string
): Promise<{ users: number; offers: number }> {
  try {
    console.log(`${LOG_PREFIX} Bidirectional sync starting...`);

    // Fetch remote state
    const remote = await fetchList(listId);
    const remoteUsers = remote.users || [];
    const remoteOffers = remote.offers || [];
    const remoteUpdatedAt = new Date(remote.updated_at).getTime();

    // Normalize remote data format (handle old format: string[] vs new format: {id, addedAt}[])
    const normalizedRemoteUsers: BlacklistEntry[] = remoteUsers.map(u =>
      typeof u === 'string' ? { id: u, addedAt: Date.now() } : u
    );
    const normalizedRemoteOffers: BlacklistEntry[] = remoteOffers.map(o =>
      typeof o === 'string' ? { id: o, addedAt: Date.now() } : o
    );

    // Fetch local state
    const localUsers = await getAllUsersWithTimestamps();
    const localOffers = await getAllOffersWithTimestamps();
    const lastSync = getLastSuccessfulSync();
    const lastLocalChange = getLastLocalChange();

    // Decide sync direction
    const remoteChanged = !lastSync || remoteUpdatedAt > lastSync;
    const localChanged = lastLocalChange && (!lastSync || lastLocalChange > lastSync);

    let finalUsers: DBEntry[];
    let finalOffers: DBEntry[];

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
      await markSuccessfulSync();
    } else if (remoteChanged) {
      // DOWNLOAD: Remote changed
      console.log(`${LOG_PREFIX} Remote changed, downloading...`);
      finalUsers = normalizedRemoteUsers;
      finalOffers = normalizedRemoteOffers;
      await updateLocalDB(finalUsers, finalOffers);
      await markSuccessfulSync();
    } else if (localChanged) {
      // UPLOAD: Local changed
      console.log(`${LOG_PREFIX} Local changed, uploading...`);
      finalUsers = localUsers;
      finalOffers = localOffers;
      await updateList(listId, editCode, {
        users: finalUsers,
        offers: finalOffers
      });
      await markSuccessfulSync();
    } else {
      // NO CHANGE
      console.log(`${LOG_PREFIX} No changes detected`);
      finalUsers = localUsers;
      finalOffers = localOffers;
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
    throw new Error(`Bidirectional sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ==================== Supabase Sync Functions ====================

/**
 * Publish personal blacklist to Supabase
 */
export async function publishToSupabase(
  name: string,
  description = ''
): Promise<{ id: string; editCode: string; isNew: boolean }> {
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
    await setPublishedList(id, editCode);

    console.log(`${LOG_PREFIX} Published successfully: ${id}`);

    return {
      id,
      editCode,
      isNew: true
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Publish error:`, error);
    throw new Error(`Не удалось опубликовать список: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sync subscriptions from Supabase and merge with personal blacklist
 */
export async function syncSubscriptions(): Promise<{ users: number; offers: number }> {
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
      await updateSubscriptionLastSynced(sub.id, now);
    }

    // Get personal blacklist
    const personalUsers = await getAllUsers();
    const personalOffers = await getAllOffers();

    // Merge personal + subscriptions
    const merged = mergeBlacklists(
      { users: personalUsers, offers: personalOffers },
      subscriptionData.map(d => ({
        users: d.users.map(u => typeof u === 'string' ? u : u.id),
        offers: d.offers.map(o => typeof o === 'string' ? o : o.id)
      }))
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
    throw new Error(`Ошибка синхронизации: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Subscribe to a read-only Supabase list
 */
export async function subscribeToList(
  listId: string
): Promise<{ name: string; description: string; users: number; offers: number }> {
  try {
    console.log(`${LOG_PREFIX} Subscribing to list ${listId}...`);

    // Fetch list metadata
    const list = await fetchList(listId);

    // Add to subscriptions
    await addSubscription(listId, list.name);

    console.log(`${LOG_PREFIX} Subscribed to "${list.name}"`);

    return {
      name: list.name,
      description: list.description,
      users: list.users.length,
      offers: list.offers.length
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Subscribe error:`, error);
    throw new Error(`Не удалось подписаться: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Import editable list (for multi-browser sync or shared editing)
 */
export async function importEditableList(
  listId: string,
  editCode: string
): Promise<{ name: string; description: string; users: number; offers: number }> {
  try {
    console.log(`${LOG_PREFIX} Importing editable list ${listId}...`);

    // Fetch list to verify it exists
    const list = await fetchList(listId);

    // Set as user's published list (grants write access)
    await setPublishedList(listId, editCode);

    console.log(`${LOG_PREFIX} Linked to editable list "${list.name}"`);

    return {
      name: list.name,
      description: list.description,
      users: list.users.length,
      offers: list.offers.length
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Import editable list error:`, error);
    throw new Error(`Не удалось подключиться к списку: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
