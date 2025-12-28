# Seamless Cross-Device Sync - Design Plan

## Problem Statement

**Current State**: Users must manually sync or wait 5 minutes for periodic sync when switching devices.

**Desired State**: User adds offer to blacklist on Device A, opens page on Device B, blacklist is automatically up-to-date.

## Current Architecture Limitations

### 1. One-Way Upload for Published Lists
- Published lists: Upload-only during periodic sync
- No download/merge of own published list
- Self-subscription is blocked (prevents conflicts)
- Result: Changes on Device A don't appear on Device B until manual sync

### 2. No Conflict Detection
- Full export/import strategy (no delta sync)
- No timestamp tracking for individual entries
- No last-write-wins or merge strategy
- Concurrent edits result in data loss

### 3. Subscription vs Published List Separation
- Subscriptions: Download-only, read-only
- Published: Upload-only
- No unified "my shared list" concept
- Users must understand two different models

### 4. Sync Timing Issues
- 5-minute periodic sync is too slow for seamless UX
- Page load sync only downloads subscriptions
- No trigger for "data changed on remote"

## Proposed Architecture: True Bidirectional Sync

### Core Concept: "My Synced List"

Replace the current publish/subscribe separation with a unified model:
- User has ONE "synced list" (stored in Supabase)
- All devices read AND write to this list
- Local IndexedDB acts as offline cache
- Automatic merge on every page load

### Key Components

#### 1. Sync Strategy: Last-Write-Wins with Timestamps

**Database Schema Addition**:
```sql
ALTER TABLE blacklists ADD COLUMN user_entries JSONB DEFAULT '[]'::jsonb;
ALTER TABLE blacklists ADD COLUMN offer_entries JSONB DEFAULT '[]'::jsonb;

-- New format for entries with timestamps:
-- [{id: "123", addedAt: 1234567890}]
```

**Merge Algorithm**:
```javascript
function mergeLists(local, remote) {
  // Convert to Maps for efficient lookup
  const localMap = new Map(local.map(e => [e.id, e.addedAt]));
  const remoteMap = new Map(remote.map(e => [e.id, e.addedAt]));

  const merged = new Map();

  // Add all remote entries (remote is source of truth)
  for (const [id, addedAt] of remoteMap) {
    merged.set(id, addedAt);
  }

  // Add local entries not in remote OR newer than remote
  for (const [id, addedAt] of localMap) {
    if (!merged.has(id)) {
      merged.set(id, addedAt); // New local entry
    }
  }

  // Detect deletions: entries in remote but not in local
  // (Only if local was modified more recently than last sync)
  // This requires tracking last_local_change timestamp

  return Array.from(merged.entries()).map(([id, addedAt]) => ({id, addedAt}));
}
```

#### 2. Change Tracking

**State Storage**:
```javascript
// Add to src/core/state.js
let _lastLocalChange = GM_getValue('lastLocalChange', null); // timestamp
let _lastSuccessfulSync = GM_getValue('lastSuccessfulSync', null); // timestamp

export function markLocalChange() {
  _lastLocalChange = Date.now();
  GM_setValue('lastLocalChange', _lastLocalChange);
}

export function getLastLocalChange() {
  return _lastLocalChange;
}

export function markSuccessfulSync() {
  _lastSuccessfulSync = Date.now();
  GM_setValue('lastSuccessfulSync', _lastSuccessfulSync);
}
```

**Usage**:
```javascript
// In src/core/db.js - Whenever user adds/removes entry
export async function addUser(userId) {
  // ... existing code ...
  markLocalChange(); // Track that local DB changed
}

export async function removeUser(userId) {
  // ... existing code ...
  markLocalChange();
}
```

#### 3. Intelligent Sync Flow

**On Page Load** (src/index.js):
```javascript
async function init() {
  await initDB();

  const syncedListId = getSyncedListId();
  const syncedEditCode = getSyncedEditCode();

  if (syncedListId && syncedEditCode) {
    // Bidirectional sync
    await bidirectionalSync(syncedListId, syncedEditCode);
    startPeriodicSync(); // Continue 5-min sync in background
  } else {
    // No synced list, use local only
    const users = await getAllUsers();
    const offers = await getAllOffers();
    setBlacklistUsers(users);
    setBlacklistOffers(offers);
  }

  // ... rest of init
}
```

**Bidirectional Sync Function** (src/core/sync.js):
```javascript
export async function bidirectionalSync(listId, editCode) {
  console.log('[ave-sync] Starting bidirectional sync...');

  // Fetch remote state
  const remote = await fetchList(listId);
  const remoteUsers = remote.users || []; // [{id, addedAt}]
  const remoteOffers = remote.offers || [];
  const remoteUpdatedAt = new Date(remote.updated_at).getTime();

  // Fetch local state
  const localUsers = await getAllUsersWithTimestamps();
  const localOffers = await getAllOffersWithTimestamps();
  const lastLocalChange = getLastLocalChange();
  const lastSync = getLastSuccessfulSync();

  // Decision tree:
  // 1. If remote newer than last sync → merge remote into local
  // 2. If local changed since last sync → upload changes
  // 3. If both changed → smart merge (union for now, can improve later)

  const remoteChangedSinceLastSync = !lastSync || remoteUpdatedAt > lastSync;
  const localChangedSinceLastSync = !lastSync || (lastLocalChange && lastLocalChange > lastSync);

  let finalUsers, finalOffers;

  if (remoteChangedSinceLastSync && localChangedSinceLastSync) {
    // CONFLICT: Both changed since last sync
    console.log('[ave-sync] Conflict detected, merging changes...');
    finalUsers = mergeLists(localUsers, remoteUsers);
    finalOffers = mergeLists(localOffers, remoteOffers);

    // Write merged result to both local and remote
    await updateLocalDB(finalUsers, finalOffers);
    await updateList(listId, editCode, {
      users: finalUsers,
      offers: finalOffers
    });
  } else if (remoteChangedSinceLastSync) {
    // Remote changed, local didn't → download
    console.log('[ave-sync] Remote changed, downloading...');
    finalUsers = remoteUsers;
    finalOffers = remoteOffers;
    await updateLocalDB(finalUsers, finalOffers);
  } else if (localChangedSinceLastSync) {
    // Local changed, remote didn't → upload
    console.log('[ave-sync] Local changed, uploading...');
    finalUsers = localUsers;
    finalOffers = localOffers;
    await updateList(listId, editCode, {
      users: finalUsers,
      offers: finalOffers
    });
  } else {
    // Neither changed → no sync needed
    console.log('[ave-sync] No changes detected, skipping sync');
    finalUsers = localUsers;
    finalOffers = localOffers;
  }

  // Update in-memory state
  setBlacklistUsers(finalUsers.map(e => e.id));
  setBlacklistOffers(finalOffers.map(e => e.id));

  // Mark successful sync
  markSuccessfulSync();

  console.log(`[ave-sync] Sync complete: ${finalUsers.length} users, ${finalOffers.length} offers`);

  return {
    users: finalUsers.length,
    offers: finalOffers.length
  };
}
```

#### 4. Migration Strategy

**Phase 1: Add Timestamp Support**
- Update IndexedDB schema to include `addedAt` timestamp
- Migrate existing entries (use creation timestamp or `Date.now()`)
- Update add/remove functions to store timestamps

**Phase 2: Update Supabase Schema**
- Add timestamp fields to JSONB entries
- Update stored functions to preserve timestamps
- Backfill existing lists with current timestamp

**Phase 3: Implement Bidirectional Sync**
- Replace one-way sync with new bidirectional logic
- Update periodic-sync.js to use new merge algorithm
- Remove self-subscription conflict checks (no longer needed)

**Phase 4: Simplify UI**
- Replace "📤 Publish" + "🔗 Import Editable" with single "🔄 Enable Sync"
- Remove manual "⬆️ Upload" / "⬇️ Download" buttons (automatic now)
- Keep subscriptions for read-only sharing with others

### Improved User Flow

#### Scenario 1: First-Time Setup (Device A)
1. User: Click "🔄 Enable Sync"
2. System: Creates new list in Supabase, saves credentials locally
3. User: Adds 5 users, 8 offers to blacklist
4. System: `markLocalChange()` called, but sync happens in background

#### Scenario 2: Second Device (Device B)
1. User: Opens ave-script menu, clicks "🔗 Connect to Synced List"
2. User: Pastes List ID + Edit Code from Device A
3. System: Fetches remote list, merges with local (empty) → 5 users, 8 offers
4. Page loads → blacklist active immediately

#### Scenario 3: Concurrent Edits
1. Device A: User blocks User123 at 10:00:00
2. Device B: User blocks User456 at 10:00:05 (hasn't synced yet)
3. Device A: Page reloads at 10:00:10
   - Uploads User123 to remote
4. Device B: Page reloads at 10:00:15
   - Downloads User123 from remote
   - Uploads User456 to remote
   - **Result**: Both User123 and User456 blocked (union merge)

#### Scenario 4: Deletion Handling (Future Enhancement)
1. Device A: User unblocks User123 at 10:00:00
2. Device B: Hasn't synced since 09:55:00, still has User123
3. Device B: Page reloads at 10:01:00
   - Downloads remote (no User123)
   - Local has User123 but remote doesn't
   - **Decision**: If local changed since last sync, keep it (re-add)
   - **Better Decision**: Track deletions explicitly with `deletedAt` timestamp

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
- [ ] Add timestamp tracking to IndexedDB schema
- [ ] Migrate existing entries with timestamps
- [ ] Add `markLocalChange()` to all add/remove operations
- [ ] Update Supabase schema to support timestamped entries
- [ ] Test timestamp persistence and migration

### Phase 2: Merge Algorithm (Week 1)
- [ ] Implement `mergeLists()` function
- [ ] Add `bidirectionalSync()` function
- [ ] Add `getLastLocalChange()` and `markSuccessfulSync()` state functions
- [ ] Unit test merge scenarios (empty, conflict, one-sided)
- [ ] Integration test with real Supabase

### Phase 3: Integration (Week 2)
- [ ] Update `init()` to use bidirectional sync instead of one-way
- [ ] Update periodic-sync.js to use new algorithm
- [ ] Remove self-subscription conflict checks
- [ ] Test on two browsers simultaneously
- [ ] Verify sync happens on page load

### Phase 4: UI Simplification (Week 2)
- [ ] Add "🔄 Enable Sync" menu command (replaces Publish + Import)
- [ ] Update "🔑 Show Credentials" to emphasize sharing
- [ ] Keep subscription UI for read-only sharing
- [ ] Remove manual upload/download buttons
- [ ] Update debug command to show sync timestamps

### Phase 5: Advanced Features (Future)
- [ ] Explicit deletion tracking (`deletedAt` timestamp)
- [ ] Reduce periodic sync interval to 1 minute
- [ ] Add Supabase Realtime for instant sync (websocket)
- [ ] Conflict resolution UI for manual merges
- [ ] Sync status indicator in UI

## Performance Considerations

### Current: Full Export/Import
- Every sync: Export all 1000+ users/offers
- JSON.stringify entire dataset
- Upload/download full payload
- **Cost**: O(n) where n = total entries

### Proposed: Delta Sync (Future Enhancement)
- Track changes since last sync
- Only upload/download modified entries
- Requires `modified_at` tracking per entry
- **Cost**: O(m) where m = changes since last sync

### Bandwidth Estimation
- Average user ID: 10 bytes
- Average offer ID: 8 bytes
- Timestamp: 8 bytes
- 1000 users: ~26 KB per sync
- With gzip: ~5-10 KB per sync
- Acceptable for 5-minute interval

## Edge Cases

### 1. Network Failure During Sync
- **Current**: Sync fails silently, retry in 5 minutes
- **Proposed**: Same behavior, local changes preserved
- **Enhancement**: Retry with exponential backoff

### 2. Invalid Edit Code (Revoked Access)
- **Current**: Supabase returns 403, sync fails
- **Proposed**: Show alert, prompt user to re-authenticate
- **Enhancement**: Refresh token mechanism

### 3. Corrupted Local DB
- **Current**: IndexedDB errors break script
- **Proposed**: Fallback to remote as source of truth
- **Enhancement**: Auto-repair by re-downloading

### 4. Concurrent Deletion and Addition
- **Example**: Device A deletes User123, Device B adds User123 (different context)
- **Current Proposal**: Union merge keeps entry
- **Better**: Track deletion explicitly, respect most recent action

## Migration Path for Existing Users

### Scenario A: User has Published List
1. On next page load, detect published list exists
2. Show one-time prompt: "Enable automatic sync for this list?"
3. If yes: Convert to synced list (keep same ID/edit code)
4. If no: Keep current one-way behavior

### Scenario B: User has Subscriptions Only
1. No change, subscriptions still work as read-only
2. User can still create their own synced list separately

### Scenario C: User has Both (Edge Case)
1. Migrate published list to synced list
2. Keep subscriptions as read-only
3. Merged data = synced list + union of subscriptions

## Testing Strategy

### Unit Tests
- [ ] mergeLists() with empty local
- [ ] mergeLists() with empty remote
- [ ] mergeLists() with conflict (same ID, different timestamp)
- [ ] mergeLists() with deletion simulation

### Integration Tests
- [ ] Two browsers, sequential edits (A then B)
- [ ] Two browsers, concurrent edits (A and B simultaneously)
- [ ] Network failure during upload
- [ ] Network failure during download
- [ ] Page reload while sync in progress

### User Acceptance Tests
- [ ] User adds entry on Device A, sees it on Device B within 5 minutes
- [ ] User deletes entry on Device A, disappears on Device B within 5 minutes
- [ ] User edits while offline, syncs when back online
- [ ] User shares list with friend (read-only subscription)

## Success Metrics

### Seamlessness
- **Target**: User switches devices, blacklist is synced within 5 seconds
- **Current**: 0-5 minutes (depending on periodic sync timing)
- **Proposed**: On page load (instant if page just loaded)

### Data Integrity
- **Target**: 0% data loss during normal operation
- **Current**: Risk of loss with self-subscription bug
- **Proposed**: Union merge prevents loss (unless explicit deletion)

### User Confusion
- **Target**: Users understand sync model within 1 minute
- **Current**: Publish vs Subscribe vs Import Editable confusion
- **Proposed**: Single "Enable Sync" concept

## Future Enhancements

### 1. Supabase Realtime (Websocket)
```javascript
const channel = supabase
  .channel('blacklist-changes')
  .on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'blacklists', filter: `id=eq.${listId}` },
    (payload) => {
      console.log('[ave-sync] Real-time update detected');
      bidirectionalSync(listId, editCode);
    }
  )
  .subscribe();
```

### 2. Optimistic UI Updates
- Add to blacklist immediately (don't wait for sync)
- Upload in background
- Rollback if sync fails

### 3. Conflict Resolution UI
- When merge conflict detected, show both versions
- Let user choose which to keep
- Store resolution preference for future

### 4. Delta Sync
- Track individual entry changes
- Only sync modified entries
- Reduces bandwidth for large lists

## Conclusion

This design replaces the current one-way publish/subscribe model with true bidirectional sync, enabling the desired user experience:

> "User adds offer to blacklist on one device, opens page on another, db is auto synced."

The key improvements:
1. **Automatic**: Syncs on every page load + every 5 minutes
2. **Bidirectional**: Both upload and download changes
3. **Conflict-Safe**: Union merge prevents data loss
4. **Simple**: One "synced list" concept instead of publish/subscribe separation

Next step: Implement Phase 1 (timestamp infrastructure) and test merge algorithm.
