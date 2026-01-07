# Changelog

All notable changes to CleanAvito will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] - 2025-01-XX

### Added

- **Cloud Synchronization** - Complete cross-device sync system powered by Supabase
  - Seamless bidirectional sync between devices
  - Auto-upload changes within 2 seconds of blocking/unblocking
  - Auto-download changes on page load
  - Periodic background sync every 5 minutes
  - Smart conflict resolution with local-wins merge strategy
  - JSON-based credentials for easy device pairing
- **Read-Only Subscriptions** - Subscribe to shared blacklists from other users
  - Subscribe to public lists using List ID
  - Automatic merging with personal blacklist
  - Manage multiple subscriptions
- **Menu Commands for Sync**
  - "☁️ Включить синхронизацию" - Create synced list
  - "☁️ Получить данные для синхронизации" - Export credentials for other devices
  - "☁️ Подключить синхронизацию" - Connect to existing synced list
  - "📥 Добавить подписку" - Subscribe to read-only lists
  - "📋 Управление подписками" - Manage subscriptions
  - "🔄 Принудительная синхронизация" - Force sync now

### Fixed

- **Mobile Empty Space** - Fixed blocked items leaving visible gaps on mobile by hiding wrapper divs
- **Auto-Pagination Default** - Changed default to disabled (was incorrectly enabled)

### Technical

- **IndexedDB v2 Schema** - Added timestamp tracking (`addedAt`) for each entry
- **Migration System** - Automatic migration from v1 to v2 on first run
- **Callback Registration Pattern** - Avoids circular dependencies between modules
- **Change Detection** - Tracks `lastLocalChange` and `lastSuccessfulSync` for smart sync

## [1.0.0] - 2025-01-XX

### Initial Release

- **Core Blacklist Functionality**
  - Block sellers by user ID
  - Block individual offers by offer ID
  - Hidden items displayed in collapsible container with counter
  - Persistent storage using IndexedDB
- **Desktop Support** (<https://www.avito.ru>)
  - Search page filtering
  - Seller page blocking
  - Auto-pagination (optional)
- **Mobile Support** (<https://m.avito.ru>)
  - Full feature parity with desktop
  - Mobile-specific selectors and UI
- **Data Management**
  - Export database to JSON file
  - Import database from JSON file
  - Statistics display (user/offer counts)
  - Clear database option
- **UI Components**
  - Block/unblock buttons on listings
  - Hidden container with expand/collapse
  - Menu commands via Tampermonkey
