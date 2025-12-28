# Supabase Shared Blacklist Implementation Plan

## Overview

Implement a collaborative blacklist system using Supabase as the backend. Users can publish their personal blacklists, subscribe to others' lists, and collaborate with shared edit codes. The system includes automatic periodic sync (every 5 minutes) and merges personal + subscribed lists seamlessly.

## Key Features

- **Publish Lists**: Users export their IndexedDB blacklist to Supabase with unique ID + edit code
- **Subscribe to Lists**: Read-only access to public lists via ID sharing
- **Collaborative Editing**: Share edit codes for write access
- **Toggleable Subscriptions**: Enable/disable each subscription individually
- **Periodic Sync**: Background sync every 5 minutes
- **Merge Strategy**: Union of personal + enabled subscriptions
- **Security**: SHA-256 hashed edit codes, Row Level Security policies

## Supabase Configuration

### Free Tier Capacity
- **Storage**: 500 MB (enough for ~60,000+ users)
- **Egress**: 5 GB/month (supports ~1.6M fetches)
- **API Requests**: Unlimited
- **Perfect for this use case**: Even 1,000 active users won't hit limits

### Database Schema

```sql
-- Main blacklists table
CREATE TABLE blacklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    edit_code_hash TEXT NOT NULL, -- SHA-256 hash
    users JSONB NOT NULL DEFAULT '[]'::jsonb,
    offers JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    owner_fingerprint TEXT,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_blacklists_id ON blacklists(id);
CREATE INDEX idx_blacklists_updated_at ON blacklists(updated_at);

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_blacklists_updated_at BEFORE UPDATE
    ON blacklists FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE blacklists ENABLE ROW LEVEL SECURITY;

-- Read access for everyone
CREATE POLICY "Enable read access for all users" ON blacklists
    FOR SELECT USING (true);

-- Insert access for everyone
CREATE POLICY "Enable insert for all users" ON blacklists
    FOR INSERT WITH CHECK (true);

-- Stored function for secure updates (edit code verification)
CREATE OR REPLACE FUNCTION update_blacklist(
    list_id UUID,
    edit_code_hash_input TEXT,
    new_users JSONB,
    new_offers JSONB,
    new_name TEXT DEFAULT NULL,
    new_description TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    stored_hash TEXT;
BEGIN
    SELECT edit_code_hash INTO stored_hash
    FROM blacklists WHERE id = list_id;

    IF stored_hash IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'List not found');
    END IF;

    IF stored_hash != edit_code_hash_input THEN
        RETURN json_build_object('success', false, 'error', 'Invalid edit code');
    END IF;

    UPDATE blacklists
    SET users = new_users,
        offers = new_offers,
        name = COALESCE(new_name, name),
        description = COALESCE(new_description, description),
        updated_at = NOW()
    WHERE id = list_id;

    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION update_blacklist TO anon;

-- Stored function for secure deletes
CREATE OR REPLACE FUNCTION delete_blacklist(
    list_id UUID,
    edit_code_hash_input TEXT
)
RETURNS JSON AS $$
DECLARE
    stored_hash TEXT;
BEGIN
    SELECT edit_code_hash INTO stored_hash
    FROM blacklists WHERE id = list_id;

    IF stored_hash IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'List not found');
    END IF;

    IF stored_hash != edit_code_hash_input THEN
        RETURN json_build_object('success', false, 'error', 'Invalid edit code');
    END IF;

    DELETE FROM blacklists WHERE id = list_id;
    RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION delete_blacklist TO anon;
```

## Key Changes from Original Requirements

1. **✅ Pastebin removed** - Deprecated, all sync via Supabase only
2. **✅ Edit code saved locally** - Stored in GM_setValue, retrievable via UI
3. **✅ Automatic updates** - Published lists auto-sync every 5 minutes (no manual update needed)
4. **✅ Multi-browser sync** - New "Import editable list" feature for same user across devices
5. **✅ Shared editing** - Same feature supports collaborative editing when edit code is shared

## Implementation Files

### 1. New File: `src/core/supabase.js` (~300 lines)

**Purpose**: Supabase client using fetch API (no SDK dependency)

**Key Functions**:
- `createList({users, offers, name, description})` → Returns `{id, editCode}`
- `updateList(listId, editCode, {users, offers, name, description})` → Updates list
- `fetchList(listId)` → Returns list data (read-only, no auth needed)
- `deleteList(listId, editCode)` → Deletes list
- `fetchLists(listIds[])` → Batch fetch multiple lists
- `sha256(message)` → Hash edit codes client-side
- `generateEditCode()` → Create random UUID edit code

**Configuration**:
```javascript
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 2. New File: `src/core/periodic-sync.js` (~100 lines)

**Purpose**: Background periodic synchronization (bidirectional)

**Key Functions**:
- `startPeriodicSync()` → Starts 5-minute interval timer
- `stopPeriodicSync()` → Stops timer
- `forceSyncNow()` → Immediate sync on demand
- `syncAndRefresh()` → Bidirectional sync + re-filtering

**Flow**:
1. **Download**: Fetch all enabled subscriptions from Supabase
2. **Upload**: If user has published list (listId + editCode exists):
   - Export current IndexedDB data
   - Push updates to Supabase via `updateList()`
3. **Merge**: Combine personal + subscriptions
4. **Update**: Set in-memory state
5. **Refresh**: Trigger `processSearchPage()` or `processMobileSearchPage()`

**Key Enhancement**: Automatic upload ensures published lists stay up-to-date without manual action

### 3. Update: `src/core/state.js` (+120 lines)

**New State Variables**:
```javascript
_publishedListId = GM_getValue('publishedListId', null);
_publishedEditCode = GM_getValue('publishedEditCode', null);
_subscriptions = GM_getValue('subscriptions', []); // [{id, name, enabled, lastSynced}]
```

**New Functions**:
- `getPublishedListId()`, `getPublishedEditCode()`
- `setPublishedList(id, editCode)`, `clearPublishedList()`
- `getSubscriptions()`, `addSubscription(id, name)`, `removeSubscription(id)`
- `toggleSubscription(id)`, `getEnabledSubscriptions()`
- `updateSubscriptionLastSynced(id, timestamp)`
- `mergeBlacklists(personal, subscriptionData)` → Returns merged Sets

**Merge Algorithm**:
```javascript
const mergedUsers = new Set(personal.users);
const mergedOffers = new Set(personal.offers);

for (const sub of subscriptionData) {
    sub.users.forEach(u => mergedUsers.add(u));
    sub.offers.forEach(o => mergedOffers.add(o));
}

return { users: mergedUsers, offers: mergedOffers };
```

### 4. Update: `src/core/sync.js` (+150 lines)

**New Functions**:

- `publishToSupabase(name, description)`:
  - Exports personal blacklist from IndexedDB
  - Creates new list OR updates existing (if published before)
  - Returns `{id, editCode, isNew}`

- `syncSubscriptions()`:
  - Fetches all enabled subscriptions from Supabase
  - Merges with personal blacklist
  - Updates in-memory state
  - Returns `{users: count, offers: count}`

- `subscribeToList(listId)`:
  - Fetches list metadata
  - Adds to subscriptions array
  - Returns `{name, description, users: count, offers: count}`

- `importEditableList(listId, editCode)`:
  - Links to existing Supabase list with edit permissions
  - Sets as user's published list (for multi-browser sync or shared edit)
  - Returns list metadata

**REMOVE all pastebin functions - deprecated in favor of Supabase**

### 5. Update: `src/ui/menu.js` (+250 lines)

**New Menu Commands**:

```
Авто-пагинация вкл/выкл (desktop only)
Статистика

━━━ Supabase Sync ━━━
📤 Опубликовать мой список
🔑 Показать ID и код редактирования
🔗 Подключить к существующему списку (импорт edit code)
📥 Добавить подписку (read-only)
📋 Управление подписками
🔄 Синхронизировать сейчас

━━━ Локальные данные ━━━
Экспорт в файл JSON
Импорт из файла
Очистить базу данных
```

**New UI Functions**:

- `publishToSupabaseUI()`:
  - Prompts for name/description (if new)
  - Calls `publishToSupabase()`
  - Shows ID + edit code (copies both to clipboard)
  - **Saves edit code locally** in GM_setValue

- `showCredentialsUI()`:
  - Displays currently stored list ID and edit code
  - Allows copying to clipboard
  - **Use case**: Retrieve credentials anytime for multi-browser sync

- `importEditableListUI()`:
  - Prompts for list ID and edit code
  - Links to existing Supabase list with write permissions
  - **Use cases**:
    - Multi-browser sync (same user, different device)
    - Shared editing (friend shares edit code)
  - Sets as user's published list
  - Syncs immediately

- `subscribeToListUI()`:
  - Prompts for list ID only (read-only subscription)
  - Calls `subscribeToList()`
  - Forces immediate sync
  - Reloads page

- `manageSubscriptionsUI()`:
  - Shows all subscriptions with status (✓/✗)
  - Actions: Toggle (1-9), Delete (D1-D9)
  - Interactive menu system

- `forceSyncUI()`:
  - Calls `forceSyncNow()`
  - Shows sync results
  - Reloads page

### 6. Update: `src/index.js` (~30 lines modified)

**Modified Initialization Flow**:

```javascript
async function init() {
    // ... existing setup ...

    await initDB();

    // Load personal blacklist
    const users = await getAllUsers();
    const offers = await getAllOffers();

    // NEW: Check for subscriptions
    const enabledSubs = getEnabledSubscriptions();

    if (enabledSubs.length > 0) {
        // Sync subscriptions on page load
        try {
            await syncSubscriptions(); // Already merges and updates state
        } catch (error) {
            console.error('Sync failed, using personal list only:', error);
            setBlacklistUsers(users);
            setBlacklistOffers(offers);
        }

        // Start periodic sync
        startPeriodicSync();
    } else {
        // No subscriptions, use personal list only
        setBlacklistUsers(users);
        setBlacklistOffers(offers);
    }

    // ... continue with platform init ...
}
```

## User Flows

### Flow 1: Publishing a List

1. User blocks sellers/offers → Stored in IndexedDB
2. User clicks "📤 Опубликовать мой список"
3. Prompted for list name (e.g., "Scammer List")
4. Script exports IndexedDB → Uploads to Supabase
5. Returns:
   - **List ID**: `abc123-def456-...` (share this publicly)
   - **Edit Code**: `xyz789-...` (keep secret!)
6. ID copied to clipboard automatically
7. User shares ID with others

### Flow 2: Subscribing to a List

1. User receives list ID from friend/community
2. User clicks "🔗 Добавить подписку"
3. Pastes ID: `abc123-def456-...`
4. Script fetches list from Supabase
5. Shows preview: "Scammer List - 150 users, 300 offers"
6. Adds to subscriptions (enabled by default)
7. Force syncs immediately
8. Page reloads → Subscribed items now blocked

### Flow 3: Periodic Sync (Automatic)

1. Every 5 minutes, background timer fires
2. Fetches all enabled subscription lists from Supabase
3. Merges: `personal ∪ sub1 ∪ sub2 ∪ ...`
4. Updates in-memory blacklist Sets
5. Triggers re-filtering on search page
6. New items from subscriptions automatically blocked

### Flow 4: Managing Subscriptions

1. User clicks "📋 Управление подписками"
2. Shows list:
   ```
   1. [✓] Scammer List (ID: abc123...)
      Synced: 2025-12-28 14:30
   2. [✗] Low Quality Sellers (ID: def456...)
      Synced: Never
   ```
3. Actions:
   - Type `1` → Toggle enabled/disabled
   - Type `D1` → Delete subscription
4. Changes apply immediately + sync + reload

### Flow 5: Updating Published List (Automatic)

1. User adds/removes sellers in personal blacklist (stored in IndexedDB)
2. **Automatic sync**: When periodic sync runs (every 5 min):
   - Checks if user has published list (has listId + editCode)
   - Exports current IndexedDB data
   - Calls `updateList()` to push changes to Supabase
   - Subscribers get updates on their next sync automatically
3. **No manual action needed** - happens in background

### Flow 6: Multi-Browser Sync / Shared Editing

**Scenario A: User wants to sync same list across multiple browsers**

1. Browser 1: User publishes list → Gets ID + edit code
2. Browser 1: Clicks "🔑 Показать ID и код редактирования" → Copies credentials
3. Browser 2: User clicks "🔗 Подключить к существующему списку"
4. Browser 2: Pastes ID and edit code
5. Browser 2: Script sets this as published list, syncs down data from Supabase
6. Both browsers now sync to same Supabase list (bidirectional)

**Scenario B: User shares edit code with friend for collaborative editing**

1. User A: Publishes list → Shares ID + edit code with User B
2. User B: Clicks "🔗 Подключить к существующему списку"
3. User B: Enters ID + edit code
4. Both User A and User B can now add/remove items
5. Changes from either user sync to Supabase and propagate to the other

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Page Load                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
            ┌────────────────┐
            │   initDB()     │
            │  Load personal │
            │  from IndexedDB│
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │ Has subscriptions? │
            └────┬──────┬─────┘
                 │      │
            YES  │      │  NO
                 │      │
                 ▼      ▼
    ┌──────────────┐   ┌──────────────┐
    │syncSubscriptions│ │setBlacklistUsers│
    │Fetch from     │   │(personal only)│
    │Supabase       │   └──────────────┘
    │               │
    │Merge:         │
    │personal ∪ subs│
    │               │
    │Update state   │
    └───────┬───────┘
            │
            ▼
    ┌──────────────┐
    │startPeriodicSync│
    │(5 min timer) │
    └───────┬───────┘
            │
            ▼
    ┌──────────────┐
    │  Render page │
    │processSearch │
    └──────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Periodic Sync (Every 5 min)                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
            ┌────────────────┐
            │syncAndRefresh()│
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │Fetch enabled   │
            │subscriptions   │
            │from Supabase   │
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │Merge with      │
            │personal list   │
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │Update in-memory│
            │Sets            │
            └────────┬───────┘
                     │
                     ▼
            ┌────────────────┐
            │Trigger re-filter│
            │(processSearchPage)│
            └────────────────┘
```

## Error Handling

### Network Failures
- **Strategy**: Silent fail with console log
- Periodic sync continues trying every 5 minutes
- User can force retry via "🔄 Синхронизировать сейчас"

### Invalid Edit Code
- **Strategy**: Alert user immediately
- "Неверный код редактирования!"
- Prevent update/delete

### Missing Subscription
- **Strategy**: Auto-cleanup
- Remove from subscriptions array
- Alert user once per session
- Continue with remaining subscriptions

### Offline Mode
- **Strategy**: Graceful degradation
- Check `navigator.onLine` before sync
- Use cached in-memory data
- Sync resumes when online

### Rate Limiting
- **Strategy**: Exponential backoff
- Retry with delays: 1s, 2s, 4s, 8s
- Max 3 retries
- Log error if all retries fail

## Security Model

### Edit Code Protection
- **Client-side**: SHA-256 hash before sending
- **Server-side**: Compare hash in stored function
- **Never transmit plaintext** edit codes over network
- Users must save edit code on creation (shown once)

### Row Level Security
- **Read**: Public (anyone with ID can read)
- **Write**: Only via stored functions with edit code verification
- **No direct UPDATE/DELETE** on table

### Privacy
- **Minimal metadata**: Only store what's necessary
- **No IP logging**: Handled by Supabase automatically
- **Public lists**: Understand that list IDs = public access

## Implementation Checklist

### Phase 1: Supabase Setup
- [ ] Create Supabase project (free tier)
- [ ] Run SQL schema (create table + functions + RLS)
- [ ] Get SUPABASE_URL and SUPABASE_ANON_KEY
- [ ] Test with Supabase dashboard

### Phase 2: Core Modules
- [ ] Create `src/core/supabase.js`
- [ ] Update `src/core/state.js` (add subscription state)
- [ ] Update `src/core/sync.js` (add Supabase functions)
- [ ] Test: Create list → Fetch list → Update list

### Phase 3: UI
- [ ] Update `src/ui/menu.js` (add all new commands)
- [ ] Test: Publish flow (get ID + edit code)
- [ ] Test: Subscribe flow (add subscription + sync)
- [ ] Test: Manage subscriptions (toggle/delete)

### Phase 4: Periodic Sync
- [ ] Create `src/core/periodic-sync.js`
- [ ] Update `src/index.js` (integrate sync on init)
- [ ] Test: Verify 5-minute interval
- [ ] Test: Verify re-filtering after sync

### Phase 5: Integration Testing
- [ ] End-to-end: Publish → Subscribe → Update → Sync
- [ ] Test on mobile and desktop
- [ ] Test error scenarios (network fail, invalid edit code)
- [ ] Performance test with large datasets

### Phase 6: Polish
- [ ] Add retry logic for network failures
- [ ] Add offline detection
- [ ] Optimize: Conditional fetch (only if updated)
- [ ] Build and test final userscript

## Configuration Notes

### Supabase Credentials
- **Hardcoded in script** (recommended for MVP)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `src/core/supabase.js`
- Anon key is designed to be public (RLS protects data)

### Edit Code Format
- **Generated**: `crypto.randomUUID()` → UUID format
- High entropy → SHA-256 sufficient (no bcrypt needed)
- User must save on creation (shown once in alert/prompt)

## Estimated Effort

- **Database Setup**: 1-2 hours
- **Core Implementation**: 8-12 hours
- **UI Development**: 4-6 hours
- **Testing**: 4-6 hours
- **Total**: 2-3 days of focused work

## Critical Files Summary

1. **`src/core/supabase.js`** - NEW - Supabase API client
2. **`src/core/periodic-sync.js`** - NEW - Bidirectional sync timer
3. **`src/core/state.js`** - MODIFY - Add subscription state
4. **`src/core/sync.js`** - MODIFY - Add Supabase functions, **REMOVE pastebin functions**
5. **`src/ui/menu.js`** - MODIFY - Add Supabase UI, **REMOVE pastebin menu items**
6. **`src/index.js`** - MODIFY - Integrate bidirectional sync on init

## Files to Remove Pastebin Code From

### `src/core/sync.js`
**Remove these functions entirely:**
- `exportToPastebin()`
- `importFromPastebin(url)`
- `SERVICES` object with dpaste configuration

### `src/ui/menu.js`
**Remove these functions:**
- `exportToPastebinUI()`
- `importFromPastebinUI()`

**Remove these menu commands:**
- `GM_registerMenuCommand('📤 Экспорт в Pastebin', exportToPastebinUI)`
- `GM_registerMenuCommand('📥 Импорт из Pastebin', importFromPastebinUI)`

## Future Enhancements (Out of Scope)

- List versioning and rollback
- Collaborative editing with permissions
- List categories/tags
- Analytics dashboard
- Realtime sync (Supabase Realtime)
- Client-side encryption
- Discover/browse popular lists
