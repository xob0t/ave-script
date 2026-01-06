/**
 * Userscript storage implementation using GM_* APIs
 */

declare function GM_getValue<T>(key: string, defaultValue: T): T;
declare function GM_setValue(key: string, value: unknown): void;

export interface Subscription {
  id: string;
  name: string;
  enabled: boolean;
  lastSynced: number | null;
}

class GMStorageItem<T> {
  constructor(
    private key: string,
    private defaultValue: T
  ) {}

  getValue(): T {
    return GM_getValue(this.key, this.defaultValue);
  }

  setValue(value: T): void {
    GM_setValue(this.key, value);
  }
}

// Storage items using GM_* APIs
export const paginationEnabled = new GMStorageItem<boolean>('ave_paginationEnabled', false);
export const publishedListId = new GMStorageItem<string | null>('ave_publishedListId', null);
export const publishedEditCode = new GMStorageItem<string | null>('ave_publishedEditCode', null);
export const subscriptions = new GMStorageItem<Subscription[]>('ave_subscriptions', []);
export const lastLocalChange = new GMStorageItem<number | null>('ave_lastLocalChange', null);
export const lastSuccessfulSync = new GMStorageItem<number | null>('ave_lastSuccessfulSync', null);
export const dbMigrationV2Done = new GMStorageItem<boolean>('ave_db_migration_v2_done', false);
