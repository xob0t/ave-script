const DB_NAME = 'AveBlacklist';
const DB_VERSION = 2;
const STORE_USERS = 'users';
const STORE_OFFERS = 'offers';

let db = null;

// Lazy-loaded to avoid circular dependency
let markLocalChangeFunc = null;
async function getMarkLocalChange() {
  if (!markLocalChangeFunc) {
    const module = await import('./state.js');
    markLocalChangeFunc = module.markLocalChange;
  }
  return markLocalChangeFunc;
}

export async function initDB() {
  console.log('[ave-db] Opening database...');

  // Use unsafeWindow.indexedDB for userscript compatibility
  const indexedDBRef = (typeof unsafeWindow !== 'undefined' && unsafeWindow.indexedDB) || indexedDB;

  if (!indexedDBRef) {
    throw new Error('IndexedDB is not available');
  }

  console.log('[ave-db] Using:', unsafeWindow?.indexedDB ? 'unsafeWindow.indexedDB' : 'window.indexedDB');

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
      console.log(`[ave-db] Upgrade needed: v${event.oldVersion} -> v${event.newVersion}`);
      const database = event.target.result;

      // Create stores if they don't exist
      if (!database.objectStoreNames.contains(STORE_USERS)) {
        console.log('[ave-db] Creating users store');
        database.createObjectStore(STORE_USERS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_OFFERS)) {
        console.log('[ave-db] Creating offers store');
        database.createObjectStore(STORE_OFFERS, { keyPath: 'id' });
      }

      // Migration: Add timestamps to existing entries (v1 -> v2)
      // Note: Migration happens AFTER onsuccess, not here
      console.log('[ave-db] Schema upgrade complete');
    };
  });
}

function getStore(storeName, mode = 'readonly') {
  if (!db) {
    throw new Error('Database not initialized');
  }
  const transaction = db.transaction(storeName, mode);
  return transaction.objectStore(storeName);
}

// Migrate old data format to new format with timestamps
async function migrateIfNeeded() {
  // Check if migration already done
  const migrated = GM_getValue('db_migration_v2_done', false);
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

  GM_setValue('db_migration_v2_done', true);
}

// Helper to get all raw entries
async function getAllRaw(storeName) {
  return new Promise((resolve, reject) => {
    const store = getStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// User operations
export async function addUser(userId) {
  const markLocalChange = await getMarkLocalChange();

  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.put({ id: userId, addedAt: Date.now() });
    request.onsuccess = () => {
      markLocalChange();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeUser(userId) {
  const markLocalChange = await getMarkLocalChange();

  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.delete(userId);
    request.onsuccess = () => {
      markLocalChange();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllUsers() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(item => item.id));
    request.onerror = () => reject(request.error);
  });
}

export async function getAllUsersWithTimestamps() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(item => ({
      id: item.id,
      addedAt: item.addedAt || Date.now()
    })));
    request.onerror = () => reject(request.error);
  });
}

export async function hasUser(userId) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS);
    const request = store.get(userId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

// Offer operations
export async function addOffer(offerId) {
  const markLocalChange = await getMarkLocalChange();

  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.put({ id: offerId, addedAt: Date.now() });
    request.onsuccess = () => {
      markLocalChange();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeOffer(offerId) {
  const markLocalChange = await getMarkLocalChange();

  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.delete(offerId);
    request.onsuccess = () => {
      markLocalChange();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllOffers() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(item => item.id));
    request.onerror = () => reject(request.error);
  });
}

export async function getAllOffersWithTimestamps() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.map(item => ({
      id: item.id,
      addedAt: item.addedAt || Date.now()
    })));
    request.onerror = () => reject(request.error);
  });
}

export async function hasOffer(offerId) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS);
    const request = store.get(offerId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

// Bulk operations
export async function clearAll() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_USERS, STORE_OFFERS], 'readwrite');
    transaction.objectStore(STORE_USERS).clear();
    transaction.objectStore(STORE_OFFERS).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearAllUsers() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllOffers() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Add user/offer with explicit timestamp (for sync operations)
export async function addUserWithTimestamp(userId, addedAt) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_USERS, 'readwrite');
    const request = store.put({ id: userId, addedAt });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function addOfferWithTimestamp(offerId, addedAt) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_OFFERS, 'readwrite');
    const request = store.put({ id: offerId, addedAt });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function exportAll() {
  const users = await getAllUsers();
  const offers = await getAllOffers();
  return { users, offers };
}

export async function importAll(data) {
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

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Run migration after DB is initialized
initDB.runMigration = migrateIfNeeded;
