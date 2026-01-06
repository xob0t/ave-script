/**
 * IndexedDB wrapper for storing blacklist data
 */

import { dbMigrationV2Done } from './storage';

const DB_NAME = 'AveBlacklist';
const DB_VERSION = 2;
const STORE_USERS = 'users';
const STORE_OFFERS = 'offers';

let db: IDBDatabase | null = null;

// Callbacks registered by external modules to avoid circular dependency
let markLocalChangeCallback: (() => void) | null = null;
let triggerAutoSyncCallback: (() => void) | null = null;

export function registerChangeCallback(callback: () => void): void {
  markLocalChangeCallback = callback;
}

export function registerAutoSyncCallback(callback: () => void): void {
  triggerAutoSyncCallback = callback;
}

export interface DBEntry {
  id: string;
  addedAt: number;
}

export async function initDB(): Promise<IDBDatabase> {
  console.log('[ave-db] Opening database...');

  const indexedDBRef = indexedDB;

  if (!indexedDBRef) {
    throw new Error('IndexedDB is not available');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDBRef.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[ave-db] Error opening database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('[ave-db] Database opened successfully');
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest;
      console.log(`[ave-db] Upgrade needed: v${event.oldVersion} -> v${event.newVersion}`);
      const database = target.result;

      // Create stores if they don't exist
      if (!database.objectStoreNames.contains(STORE_USERS)) {
        console.log('[ave-db] Creating users store');
        database.createObjectStore(STORE_USERS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_OFFERS)) {
        console.log('[ave-db] Creating offers store');
        database.createObjectStore(STORE_OFFERS, { keyPath: 'id' });
      }

      console.log('[ave-db] Schema upgrade complete');
    };
  });
}

function getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

// Migrate old data format to new format with timestamps
async function migrateIfNeeded(): Promise<void> {
  const migrated = await dbMigrationV2Done.getValue();
  if (migrated) {
    console.log('[ave-db] Migration already completed');
    return;
  }

  console.log('[ave-db] Checking for migration...');

  const users = await getAllRaw(STORE_USERS);
  const offers = await getAllRaw(STORE_OFFERS);

  let needsMigration = false;
  const timestamp = Date.now();

  // Migrate users
  for (const user of users) {
    if (!user.addedAt) {
      needsMigration = true;
      user.addedAt = timestamp;
      const store = getStore(STORE_USERS, 'readwrite');
      store.put(user);
    }
  }

  // Migrate offers
  for (const offer of offers) {
    if (!offer.addedAt) {
      needsMigration = true;
      offer.addedAt = timestamp;
      const store = getStore(STORE_OFFERS, 'readwrite');
      store.put(offer);
    }
  }

  if (needsMigration) {
    console.log(`[ave-db] Migrated ${users.length} users, ${offers.length} offers`);
  }

  await dbMigrationV2Done.setValue(true);
}

// Helper to get all raw entries
async function getAllRaw(storeName: string): Promise<DBEntry[]> {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// User operations
export async function addUser(userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.put({ id: userId, addedAt: Date.now() });
    request.onsuccess = () => {
      if (markLocalChangeCallback) markLocalChangeCallback();
      if (triggerAutoSyncCallback) triggerAutoSyncCallback();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeUser(userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.delete(userId);
    request.onsuccess = () => {
      if (markLocalChangeCallback) markLocalChangeCallback();
      if (triggerAutoSyncCallback) triggerAutoSyncCallback();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllUsers(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as DBEntry[]).map(item => item.id));
    request.onerror = () => reject(request.error);
  });
}

export async function getAllUsersWithTimestamps(): Promise<DBEntry[]> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as DBEntry[]).map(item => ({
      id: item.id,
      addedAt: item.addedAt || Date.now()
    })));
    request.onerror = () => reject(request.error);
  });
}

export async function hasUser(userId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.get(userId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

// Offer operations
export async function addOffer(offerId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.put({ id: offerId, addedAt: Date.now() });
    request.onsuccess = () => {
      if (markLocalChangeCallback) markLocalChangeCallback();
      if (triggerAutoSyncCallback) triggerAutoSyncCallback();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeOffer(offerId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.delete(offerId);
    request.onsuccess = () => {
      if (markLocalChangeCallback) markLocalChangeCallback();
      if (triggerAutoSyncCallback) triggerAutoSyncCallback();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllOffers(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as DBEntry[]).map(item => item.id));
    request.onerror = () => reject(request.error);
  });
}

export async function getAllOffersWithTimestamps(): Promise<DBEntry[]> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as DBEntry[]).map(item => ({
      id: item.id,
      addedAt: item.addedAt || Date.now()
    })));
    request.onerror = () => reject(request.error);
  });
}

export async function hasOffer(offerId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.get(offerId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

// Bulk operations
export async function clearAll(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    const transaction = db.transaction([STORE_USERS, STORE_OFFERS], 'readwrite');
    transaction.objectStore(STORE_USERS).clear();
    transaction.objectStore(STORE_OFFERS).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearAllUsers(): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllOffers(): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Add user/offer with explicit timestamp (for sync operations)
export async function addUserWithTimestamp(userId: string, addedAt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.put({ id: userId, addedAt });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function addOfferWithTimestamp(offerId: string, addedAt: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.put({ id: offerId, addedAt });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function exportAll(): Promise<{ users: string[]; offers: string[] }> {
  const users = await getAllUsers();
  const offers = await getAllOffers();
  return { users, offers };
}

export async function importAll(data: { users?: string[]; offers?: string[] }): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'));
      return;
    }
    const transaction = db.transaction([STORE_USERS, STORE_OFFERS], 'readwrite');
    const usersStore = transaction.objectStore(STORE_USERS);
    const offersStore = transaction.objectStore(STORE_OFFERS);

    const timestamp = Date.now();

    // Import users
    if (data.users && Array.isArray(data.users)) {
      for (const userId of data.users) {
        usersStore.put({ id: userId, addedAt: timestamp });
      }
    }

    // Import offers
    if (data.offers && Array.isArray(data.offers)) {
      for (const offerId of data.offers) {
        offersStore.put({ id: offerId, addedAt: timestamp });
      }
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Run migration after DB is initialized
export const runMigration = migrateIfNeeded;
