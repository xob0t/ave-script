/**
 * Browser storage wrapper to replace GM_getValue/GM_setValue
 * Uses browser.storage.local for cross-browser compatibility
 */

import { storage } from 'wxt/storage';

// Define storage items with type safety
export const paginationEnabled = storage.defineItem<boolean>('local:paginationEnabled', {
  fallback: false,
});

export const publishedListId = storage.defineItem<string | null>('local:publishedListId', {
  fallback: null,
});

export const publishedEditCode = storage.defineItem<string | null>('local:publishedEditCode', {
  fallback: null,
});

export const subscriptions = storage.defineItem<Subscription[]>('local:subscriptions', {
  fallback: [],
});

export const lastLocalChange = storage.defineItem<number | null>('local:lastLocalChange', {
  fallback: null,
});

export const lastSuccessfulSync = storage.defineItem<number | null>('local:lastSuccessfulSync', {
  fallback: null,
});

export const dbMigrationV2Done = storage.defineItem<boolean>('local:db_migration_v2_done', {
  fallback: false,
});

// Type definitions
export interface Subscription {
  id: string;
  name: string;
  enabled: boolean;
  lastSynced: number | null;
}
