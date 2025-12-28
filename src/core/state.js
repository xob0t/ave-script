export let catalogData = [];
export let mobileCatalogData = [];
export let blacklistUsers = new Set();
export let blacklistOffers = new Set();
// Load pagination state from storage (default to false if not set)
let _isPaginationEnabled = GM_getValue('paginationEnabled', false);
let _isLoading = false;

export function isPaginationEnabled() {
  return _isPaginationEnabled;
}

export function isLoading() {
  return _isLoading;
}

export function setCatalogData(data) {
  catalogData = data;
}

export function appendCatalogData(data) {
  catalogData = [...catalogData, ...data];
}

// Mobile catalog data - stores raw API response items
export function setMobileCatalogData(items) {
  mobileCatalogData = items;
}

export function appendMobileCatalogData(items) {
  // Deduplicate by item ID when appending
  const existingIds = new Set(mobileCatalogData.map(item => item.value?.id));
  const newItems = items.filter(item => !existingIds.has(item.value?.id));
  if (newItems.length > 0) {
    console.log(`[ave] Added ${newItems.length} new items to catalog (total: ${mobileCatalogData.length + newItems.length})`);
  }
  mobileCatalogData = [...mobileCatalogData, ...newItems];
}

export function setBlacklistUsers(users) {
  blacklistUsers = new Set(users);
}

export function setBlacklistOffers(offers) {
  blacklistOffers = new Set(offers);
}

export function addToBlacklistUsers(userId) {
  blacklistUsers.add(userId);
}

export function removeFromBlacklistUsers(userId) {
  blacklistUsers.delete(userId);
}

export function addToBlacklistOffers(offerId) {
  blacklistOffers.add(offerId);
}

export function removeFromBlacklistOffers(offerId) {
  blacklistOffers.delete(offerId);
}

export function isUserBlacklisted(userId) {
  return blacklistUsers.has(userId);
}

export function isOfferBlacklisted(offerId) {
  return blacklistOffers.has(offerId);
}

export function setPaginationEnabled(enabled) {
  _isPaginationEnabled = enabled;
  GM_setValue('paginationEnabled', enabled);
}

export function setLoading(loading) {
  _isLoading = loading;
}

// ==================== Supabase Subscription State ====================

// Published list credentials (stored persistently)
let _publishedListId = GM_getValue('publishedListId', null);
let _publishedEditCode = GM_getValue('publishedEditCode', null);

// Subscriptions array: [{id: UUID, name: string, enabled: boolean, lastSynced: timestamp}]
let _subscriptions = GM_getValue('subscriptions', []);

// Change tracking for bidirectional sync
let _lastLocalChange = GM_getValue('lastLocalChange', null);
let _lastSuccessfulSync = GM_getValue('lastSuccessfulSync', null);

/**
 * Get the published list ID (if user has published their list)
 * @returns {string|null}
 */
export function getPublishedListId() {
  return _publishedListId;
}

/**
 * Get the published edit code
 * @returns {string|null}
 */
export function getPublishedEditCode() {
  return _publishedEditCode;
}

/**
 * Set published list credentials
 * @param {string} id - List UUID
 * @param {string} editCode - Edit code
 */
export function setPublishedList(id, editCode) {
  _publishedListId = id;
  _publishedEditCode = editCode;
  GM_setValue('publishedListId', id);
  GM_setValue('publishedEditCode', editCode);
}

/**
 * Clear published list credentials
 */
export function clearPublishedList() {
  _publishedListId = null;
  _publishedEditCode = null;
  GM_deleteValue('publishedListId');
  GM_deleteValue('publishedEditCode');
}

/**
 * Get all subscriptions
 * @returns {Array<{id: string, name: string, enabled: boolean, lastSynced: number|null}>}
 */
export function getSubscriptions() {
  return _subscriptions;
}

/**
 * Get only enabled subscriptions
 * @returns {Array<{id: string, name: string, enabled: boolean, lastSynced: number|null}>}
 */
export function getEnabledSubscriptions() {
  return _subscriptions.filter(sub => sub.enabled);
}

/**
 * Add a new subscription
 * @param {string} id - List UUID
 * @param {string} name - List name
 */
export function addSubscription(id, name) {
  // Check if already subscribed
  const existing = _subscriptions.find(sub => sub.id === id);
  if (existing) {
    throw new Error('Already subscribed to this list');
  }

  _subscriptions.push({
    id,
    name,
    enabled: true,
    lastSynced: null
  });

  GM_setValue('subscriptions', _subscriptions);
}

/**
 * Remove a subscription
 * @param {string} id - List UUID
 */
export function removeSubscription(id) {
  _subscriptions = _subscriptions.filter(sub => sub.id !== id);
  GM_setValue('subscriptions', _subscriptions);
}

/**
 * Toggle subscription enabled/disabled
 * @param {string} id - List UUID
 */
export function toggleSubscription(id) {
  const sub = _subscriptions.find(sub => sub.id === id);
  if (sub) {
    sub.enabled = !sub.enabled;
    GM_setValue('subscriptions', _subscriptions);
  }
}

/**
 * Update subscription last synced timestamp
 * @param {string} id - List UUID
 * @param {number} timestamp - Timestamp in milliseconds
 */
export function updateSubscriptionLastSynced(id, timestamp) {
  const sub = _subscriptions.find(sub => sub.id === id);
  if (sub) {
    sub.lastSynced = timestamp;
    GM_setValue('subscriptions', _subscriptions);
  }
}

/**
 * Merge personal blacklist with subscription data
 * @param {object} personal - Personal blacklist {users: Array, offers: Array}
 * @param {Array<object>} subscriptionData - Array of subscription lists [{users: Array, offers: Array}, ...]
 * @returns {{users: Set, offers: Set}}
 */
export function mergeBlacklists(personal, subscriptionData) {
  const mergedUsers = new Set(personal.users || []);
  const mergedOffers = new Set(personal.offers || []);

  for (const sub of subscriptionData) {
    if (sub.users) {
      sub.users.forEach(u => mergedUsers.add(u));
    }
    if (sub.offers) {
      sub.offers.forEach(o => mergedOffers.add(o));
    }
  }

  return {
    users: mergedUsers,
    offers: mergedOffers
  };
}

// ==================== Change Tracking (for bidirectional sync) ====================

/**
 * Mark that local DB has changed
 * Used to track when uploads are needed
 */
export function markLocalChange() {
  _lastLocalChange = Date.now();
  GM_setValue('lastLocalChange', _lastLocalChange);
}

/**
 * Get timestamp of last local change
 * @returns {number|null}
 */
export function getLastLocalChange() {
  return _lastLocalChange;
}

/**
 * Mark that a successful sync completed
 * Used to track baseline for next sync
 */
export function markSuccessfulSync() {
  _lastSuccessfulSync = Date.now();
  GM_setValue('lastSuccessfulSync', _lastSuccessfulSync);
}

/**
 * Get timestamp of last successful sync
 * @returns {number|null}
 */
export function getLastSuccessfulSync() {
  return _lastSuccessfulSync;
}
