/**
 * Userscript state management - uses GM_* storage
 * This is a complete implementation (not a re-export) to avoid circular references
 */

import {
  paginationEnabled,
  publishedListId,
  publishedEditCode,
  subscriptions,
  lastLocalChange,
  lastSuccessfulSync,
  type Subscription,
} from './storage';

// Catalog data for current page
export let catalogData: CatalogItem[] = [];
export let mobileCatalogData: MobileCatalogItem[] = [];

// Blacklist sets (in-memory for fast lookups)
export let blacklistUsers = new Set<string>();
export let blacklistOffers = new Set<string>();

// Cached state values
let _isPaginationEnabled = false;
let _isLoading = false;
let _publishedListId: string | null = null;
let _publishedEditCode: string | null = null;
let _subscriptions: Subscription[] = [];
let _lastLocalChange: number | null = null;
let _lastSuccessfulSync: number | null = null;

// Types
export interface CatalogItem {
  id: number;
  categoryId?: number;
  userId?: string;
  iva?: {
    UserInfoStep?: Array<{
      payload?: {
        profile?: {
          link?: string;
        };
      };
    }>;
  };
}

export interface MobileCatalogItem {
  type?: string;
  value?: {
    id?: number;
    sellerInfo?: {
      userKey?: string;
    };
  };
}

// Initialize state from GM storage (synchronous for userscript)
export function initState(): void {
  _isPaginationEnabled = paginationEnabled.getValue();
  _publishedListId = publishedListId.getValue();
  _publishedEditCode = publishedEditCode.getValue();
  _subscriptions = subscriptions.getValue();
  _lastLocalChange = lastLocalChange.getValue();
  _lastSuccessfulSync = lastSuccessfulSync.getValue();
}

// Pagination state
export function isPaginationEnabled(): boolean {
  return _isPaginationEnabled;
}

export function isLoading(): boolean {
  return _isLoading;
}

export async function setPaginationEnabled(enabled: boolean): Promise<void> {
  _isPaginationEnabled = enabled;
  paginationEnabled.setValue(enabled);
}

export function setLoading(loading: boolean): void {
  _isLoading = loading;
}

// Catalog data management
export function setCatalogData(data: CatalogItem[]): void {
  catalogData = data;
}

export function appendCatalogData(data: CatalogItem[]): void {
  catalogData = [...catalogData, ...data];
}

export function setMobileCatalogData(items: MobileCatalogItem[]): void {
  mobileCatalogData = items;
}

export function appendMobileCatalogData(items: MobileCatalogItem[]): void {
  const existingIds = new Set(
    mobileCatalogData
      .map(item => item.value?.id)
      .filter((id): id is number => id !== undefined)
  );
  const newItems = items.filter(item => {
    const id = item.value?.id;
    return id !== undefined && !existingIds.has(id);
  });
  if (newItems.length > 0) {
    console.log(`[ave] Added ${newItems.length} new items to catalog (total: ${mobileCatalogData.length + newItems.length})`);
  }
  mobileCatalogData = [...mobileCatalogData, ...newItems];
}

// Blacklist management
export function setBlacklistUsers(users: string[]): void {
  blacklistUsers = new Set(users);
}

export function setBlacklistOffers(offers: string[]): void {
  blacklistOffers = new Set(offers);
}

export function addToBlacklistUsers(userId: string): void {
  blacklistUsers.add(userId);
}

export function removeFromBlacklistUsers(userId: string): void {
  blacklistUsers.delete(userId);
}

export function addToBlacklistOffers(offerId: string): void {
  blacklistOffers.add(offerId);
}

export function removeFromBlacklistOffers(offerId: string): void {
  blacklistOffers.delete(offerId);
}

export function isUserBlacklisted(userId: string): boolean {
  return blacklistUsers.has(userId);
}

export function isOfferBlacklisted(offerId: string): boolean {
  return blacklistOffers.has(offerId);
}

// ==================== Supabase Subscription State ====================

export function getPublishedListId(): string | null {
  return _publishedListId;
}

export function getPublishedEditCode(): string | null {
  return _publishedEditCode;
}

export async function setPublishedList(id: string, editCode: string): Promise<void> {
  _publishedListId = id;
  _publishedEditCode = editCode;
  publishedListId.setValue(id);
  publishedEditCode.setValue(editCode);
}

export async function setPublishedListId(id: string | null): Promise<void> {
  _publishedListId = id;
  publishedListId.setValue(id);
}

export async function setPublishedEditCode(code: string | null): Promise<void> {
  _publishedEditCode = code;
  publishedEditCode.setValue(code);
}

export async function clearPublishedList(): Promise<void> {
  _publishedListId = null;
  _publishedEditCode = null;
  publishedListId.setValue(null);
  publishedEditCode.setValue(null);
}

export function getSubscriptions(): Subscription[] {
  return _subscriptions;
}

export function getEnabledSubscriptions(): Subscription[] {
  return _subscriptions.filter(sub => sub.enabled);
}

export async function addSubscription(id: string, name: string): Promise<void> {
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

  subscriptions.setValue(_subscriptions);
}

export async function removeSubscription(id: string): Promise<void> {
  _subscriptions = _subscriptions.filter(sub => sub.id !== id);
  subscriptions.setValue(_subscriptions);
}

export async function toggleSubscription(id: string): Promise<void> {
  const sub = _subscriptions.find(sub => sub.id === id);
  if (sub) {
    sub.enabled = !sub.enabled;
    subscriptions.setValue(_subscriptions);
  }
}

export async function updateSubscriptionLastSynced(id: string, timestamp: number): Promise<void> {
  const sub = _subscriptions.find(sub => sub.id === id);
  if (sub) {
    sub.lastSynced = timestamp;
    subscriptions.setValue(_subscriptions);
  }
}

export function mergeBlacklists(
  personal: { users?: string[]; offers?: string[] },
  subscriptionData: Array<{ users?: string[]; offers?: string[] }>
): { users: Set<string>; offers: Set<string> } {
  const mergedUsers = new Set<string>(personal.users || []);
  const mergedOffers = new Set<string>(personal.offers || []);

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

export async function markLocalChange(): Promise<void> {
  _lastLocalChange = Date.now();
  lastLocalChange.setValue(_lastLocalChange);
}

export function getLastLocalChange(): number | null {
  return _lastLocalChange;
}

export async function markSuccessfulSync(): Promise<void> {
  _lastSuccessfulSync = Date.now();
  lastSuccessfulSync.setValue(_lastSuccessfulSync);
}

export function getLastSuccessfulSync(): number | null {
  return _lastSuccessfulSync;
}

export function hasLocalChanges(): boolean {
  if (_lastLocalChange === null) return false;
  if (_lastSuccessfulSync === null) return true;
  return _lastLocalChange > _lastSuccessfulSync;
}
