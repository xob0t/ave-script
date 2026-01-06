/**
 * Extension popup menu functionality
 * Replaces GM_registerMenuCommand with browser extension context menu
 */

import { exportAll, clearAll, importAll, getAllUsers, getAllOffers } from './db';
import {
  setBlacklistUsers,
  setBlacklistOffers,
  isPaginationEnabled,
  setPaginationEnabled,
  getPublishedListId,
  getPublishedEditCode,
  getSubscriptions,
  removeSubscription,
  toggleSubscription
} from './state';
import { checkPaginationVisibility } from './desktop/pagination';
import {
  publishToSupabase,
  subscribeToList,
  importEditableList
} from './sync';
import { forceSyncNow } from './periodic-sync';
import { fetchList } from './supabase';

const isMobile = typeof window !== 'undefined' && window.location.hostname === 'm.avito.ru';

const LOG_PREFIX = '[ave]';

async function exportDatabase(): Promise<void> {
  try {
    const data = await exportAll();
    const serializedData = JSON.stringify(data, null, 2);
    const blob = new Blob([serializedData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'avito_blacklist_database.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`${LOG_PREFIX} Database exported successfully`);
    alert('База данных экспортирована!');
  } catch (error) {
    console.error(`${LOG_PREFIX} Error exporting database:`, error);
    alert('Ошибка экспорта: ' + (error as Error).message);
  }
}

async function processImport(jsonText: string): Promise<void> {
  try {
    const data = JSON.parse(jsonText) as { users?: string[]; offers?: string[] };

    if (!data.users && !data.offers) {
      throw new Error('Неверный формат данных');
    }

    await importAll(data);

    // Update in-memory state
    const users = await getAllUsers();
    const offers = await getAllOffers();
    setBlacklistUsers(users);
    setBlacklistOffers(offers);

    const usersCount = data.users?.length || 0;
    const offersCount = data.offers?.length || 0;
    console.log(`${LOG_PREFIX} Database imported: ${usersCount} users, ${offersCount} offers`);
    alert(`Импортировано: ${usersCount} пользователей, ${offersCount} объявлений`);
    location.reload();
  } catch (error) {
    console.error(`${LOG_PREFIX} Error importing database:`, error);
    alert('Ошибка импорта: ' + (error as Error).message);
  }
}

async function importFromFile(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      await processImport(event.target?.result as string);
    };
    reader.onerror = () => {
      alert('Ошибка чтения файла');
    };
    reader.readAsText(file);
  };

  input.click();
}

async function showStats(): Promise<void> {
  try {
    const users = await getAllUsers();
    const offers = await getAllOffers();
    alert(`Статистика базы данных:\n\nПользователей в ЧС: ${users.length}\nОбъявлений в ЧС: ${offers.length}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error getting stats:`, error);
    alert('Ошибка получения статистики: ' + (error as Error).message);
  }
}

async function togglePagination(): Promise<void> {
  const newState = !isPaginationEnabled();
  await setPaginationEnabled(newState);
  alert(`Авто-пагинация ${newState ? 'включена' : 'выключена'}`);
  if (newState && !isMobile) {
    checkPaginationVisibility();
  }
}

async function clearDatabase(): Promise<void> {
  if (confirm('База данных будет очищена, вы уверены?')) {
    try {
      await clearAll();
      setBlacklistUsers([]);
      setBlacklistOffers([]);
      console.log(`${LOG_PREFIX} Database cleared`);
      alert('База данных очищена!');
      location.reload();
    } catch (error) {
      console.error(`${LOG_PREFIX} Error clearing database:`, error);
      alert('Ошибка очистки: ' + (error as Error).message);
    }
  }
}

// ==================== Supabase UI Functions ====================

async function publishToSupabaseUI(): Promise<void> {
  try {
    const existingId = getPublishedListId();

    if (existingId) {
      alert(
        'Синхронизация уже включена!\n\n' +
        'Для подключения другого устройства используйте:\n' +
        '"☁️ Получить данные для синхронизации"'
      );
      return;
    }

    const name = prompt('Включение синхронизации\n\nВведите название списка:', 'Мой черный список');
    if (!name) return;

    const description = prompt('Описание (необязательно):') || '';

    const result = await publishToSupabase(name, description);

    alert(
      `✅ Синхронизация включена!\n\n` +
      `Изменения будут автоматически синхронизироваться между устройствами.\n\n` +
      `Для подключения другого устройства используйте:\n` +
      `"☁️ Получить данные для синхронизации"`
    );

    console.log(`${LOG_PREFIX} Published to Supabase: ${result.id}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error publishing to Supabase:`, error);
    alert('Ошибка публикации: ' + (error as Error).message);
  }
}

async function showCredentialsUI(): Promise<void> {
  const listId = getPublishedListId();
  const editCode = getPublishedEditCode();

  if (!listId || !editCode) {
    alert('Синхронизация не включена.\n\nИспользуйте "☁️ Включить синхронизацию" для настройки.');
    return;
  }

  const credentialsJSON = JSON.stringify({ listId, editCode });

  try {
    await navigator.clipboard.writeText(credentialsJSON);
    alert(
      `✅ Данные для синхронизации скопированы!\n\n` +
      `Для подключения другого устройства:\n` +
      `1. Откройте меню на другом устройстве\n` +
      `2. Выберите "☁️ Подключить синхронизацию"\n` +
      `3. Вставьте эти данные из буфера обмена`
    );
  } catch {
    prompt('Скопируйте данные для синхронизации:', credentialsJSON);
  }
}

async function importEditableListUI(): Promise<void> {
  const input = prompt(
    'Подключение синхронизации\n\n' +
    'Вставьте данные из буфера обмена:\n' +
    '{"listId":"...","editCode":"..."}\n\n' +
    'Получить данные можно на другом устройстве:\n' +
    '"☁️ Получить данные для синхронизации"'
  );

  if (!input || !input.trim()) return;

  let listId: string, editCode: string;

  try {
    const parsed = JSON.parse(input.trim()) as { listId?: string; editCode?: string };
    if (!parsed.listId || !parsed.editCode) {
      throw new Error('JSON должен содержать listId и editCode');
    }
    listId = parsed.listId;
    editCode = parsed.editCode;
  } catch (e) {
    alert(`Ошибка формата JSON:\n\n${(e as Error).message}\n\nОжидается: {"listId":"...","editCode":"..."}`);
    return;
  }

  try {
    const result = await importEditableList(listId, editCode);

    alert(
      `✅ Синхронизация подключена!\n\n` +
      `📋 Список: ${result.name}\n` +
      `👥 Пользователей: ${result.users}\n` +
      `📦 Объявлений: ${result.offers}\n\n` +
      `Изменения автоматически синхронизируются между устройствами.`
    );

    await forceSyncNow();
    location.reload();
  } catch (error) {
    console.error(`${LOG_PREFIX} Error importing editable list:`, error);
    alert('Ошибка подключения: ' + (error as Error).message);
  }
}

async function subscribeToListUI(): Promise<void> {
  const listId = prompt(
    'Введите List ID для подписки:\n\n' +
    'Это read-only подписка.\n' +
    'Вы будете получать обновления, но не сможете редактировать список.'
  );

  if (!listId || !listId.trim()) return;

  try {
    const result = await subscribeToList(listId.trim());

    alert(
      `✅ Подписка добавлена!\n\n` +
      `📋 Название: ${result.name}\n` +
      `📝 Описание: ${result.description}\n` +
      `👥 Пользователей: ${result.users}\n` +
      `📦 Объявлений: ${result.offers}`
    );

    await forceSyncNow();
    location.reload();
  } catch (error) {
    console.error(`${LOG_PREFIX} Error subscribing to list:`, error);
    alert('Ошибка подписки: ' + (error as Error).message);
  }
}

async function manageSubscriptionsUI(): Promise<void> {
  const subs = getSubscriptions();

  if (subs.length === 0) {
    alert('У вас нет подписок.\n\nИспользуйте "📥 Добавить подписку" для добавления списков.');
    return;
  }

  let message = '📋 Управление подписками:\n\n';

  subs.forEach((sub, index) => {
    const status = sub.enabled ? '✓' : '✗';
    const lastSynced = sub.lastSynced
      ? new Date(sub.lastSynced).toLocaleString('ru-RU')
      : 'Никогда';

    message += `${index + 1}. [${status}] ${sub.name}\n`;
    message += `   ID: ${sub.id.substring(0, 8)}...\n`;
    message += `   Синхронизировано: ${lastSynced}\n\n`;
  });

  message += '\nДействия:\n';
  message += '• Введите номер (1-9) для вкл/выкл\n';
  message += '• Введите D1-D9 для удаления\n';
  message += '• Нажмите Cancel для выхода';

  const action = prompt(message);

  if (!action) return;

  const actionTrimmed = action.trim().toUpperCase();

  if (actionTrimmed.startsWith('D')) {
    const numStr = actionTrimmed.substring(1);
    const num = parseInt(numStr);

    if (num >= 1 && num <= subs.length) {
      const sub = subs[num - 1];
      if (confirm(`Удалить подписку "${sub.name}"?`)) {
        await removeSubscription(sub.id);
        alert('Подписка удалена!');
        await forceSyncNow();
        location.reload();
      }
    } else {
      alert('Неверный номер');
    }
    return;
  }

  const num = parseInt(actionTrimmed);
  if (num >= 1 && num <= subs.length) {
    const sub = subs[num - 1];
    await toggleSubscription(sub.id);
    alert(`Подписка "${sub.name}" ${sub.enabled ? 'отключена' : 'включена'}!`);
    await forceSyncNow();
    location.reload();
  } else {
    alert('Неверный ввод');
  }
}

async function forceSyncUI(): Promise<void> {
  try {
    alert('Синхронизация начата...');

    const result = await forceSyncNow();

    alert(
      `✅ Синхронизация завершена!\n\n` +
      `👥 Пользователей: ${result.users}\n` +
      `📦 Объявлений: ${result.offers}`
    );

    location.reload();
  } catch (error) {
    console.error(`${LOG_PREFIX} Error during force sync:`, error);
    alert('Ошибка синхронизации: ' + (error as Error).message);
  }
}

async function debugSyncStateUI(): Promise<void> {
  try {
    console.log('=== AVE SYNC DEBUG STATE ===');

    const localUsers = await getAllUsers();
    const localOffers = await getAllOffers();
    console.log('📦 LOCAL DB:');
    console.log(`  Users: ${localUsers.length}`, localUsers);
    console.log(`  Offers: ${localOffers.length}`, localOffers);

    const publishedId = getPublishedListId();
    const publishedEditCode = getPublishedEditCode();
    console.log('\n📤 PUBLISHED LIST:');
    if (publishedId && publishedEditCode) {
      console.log(`  List ID: ${publishedId}`);
      console.log(`  Edit Code: ${publishedEditCode}`);

      try {
        const remoteList = await fetchList(publishedId);
        console.log('\n☁️ REMOTE STATE (Published List):');
        console.log(`  Name: ${remoteList.name}`);
        console.log(`  Description: ${remoteList.description}`);
        console.log(`  Users: ${remoteList.users.length}`, remoteList.users);
        console.log(`  Offers: ${remoteList.offers.length}`, remoteList.offers);
        console.log(`  Created: ${remoteList.created_at}`);
        console.log(`  Updated: ${remoteList.updated_at}`);
      } catch (error) {
        console.error('  ❌ Failed to fetch remote list:', (error as Error).message);
      }
    } else {
      console.log('  Not published');
    }

    const subs = getSubscriptions();
    console.log('\n📥 SUBSCRIPTIONS:');
    if (subs.length > 0) {
      for (const sub of subs) {
        console.log(`\n  ${sub.enabled ? '✓' : '✗'} ${sub.name}`);
        console.log(`    ID: ${sub.id}`);
        console.log(`    Last Synced: ${sub.lastSynced ? new Date(sub.lastSynced).toLocaleString() : 'Never'}`);

        try {
          const remoteList = await fetchList(sub.id);
          console.log(`    Remote Users: ${remoteList.users.length}`);
          console.log(`    Remote Offers: ${remoteList.offers.length}`);
          console.log(`    Remote Updated: ${remoteList.updated_at}`);
        } catch (error) {
          console.error(`    ❌ Failed to fetch: ${(error as Error).message}`);
        }
      }
    } else {
      console.log('  No subscriptions');
    }

    console.log('\n=== END DEBUG STATE ===');

    alert(
      `🐛 Debug info logged to console!\n\n` +
      `Open browser console (F12) to view detailed state.\n\n` +
      `📦 Local DB: ${localUsers.length} users, ${localOffers.length} offers\n` +
      `📤 Published: ${publishedId ? 'Yes' : 'No'}\n` +
      `📥 Subscriptions: ${subs.length}`
    );
  } catch (error) {
    console.error(`${LOG_PREFIX} Debug error:`, error);
    alert('Ошибка отладки: ' + (error as Error).message);
  }
}

// Export menu actions for use in popup or context menu
export const menuActions = {
  togglePagination,
  showStats,
  publishToSupabase: publishToSupabaseUI,
  showCredentials: showCredentialsUI,
  importEditableList: importEditableListUI,
  subscribeToList: subscribeToListUI,
  manageSubscriptions: manageSubscriptionsUI,
  forceSync: forceSyncUI,
  debugSyncState: debugSyncStateUI,
  exportDatabase,
  importFromFile,
  clearDatabase,
  isMobile
};

// Create context menu UI for extensions
export function createContextMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'ave-context-menu';
  menu.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: white;
    border: 1px solid #ccc;
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 999999;
    display: none;
    min-width: 250px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
  `;

  const menuItems = [
    { label: 'Статистика', action: showStats },
    { label: '─────────────────', separator: true },
    { label: '☁️ Включить синхронизацию', action: publishToSupabaseUI },
    { label: '☁️ Получить данные синхронизации', action: showCredentialsUI },
    { label: '☁️ Подключить синхронизацию', action: importEditableListUI },
    { label: '📥 Добавить подписку', action: subscribeToListUI },
    { label: '📋 Управление подписками', action: manageSubscriptionsUI },
    { label: '🔄 Принудительная синхронизация', action: forceSyncUI },
    { label: '─────────────────', separator: true },
    { label: 'Экспорт в JSON', action: exportDatabase },
    { label: 'Импорт из файла', action: importFromFile },
    { label: 'Очистить базу данных', action: clearDatabase },
    { label: '─────────────────', separator: true },
    { label: '🐛 Debug: Log Sync State', action: debugSyncStateUI },
  ];

  if (!isMobile) {
    menuItems.unshift({ label: 'Авто-пагинация вкл/выкл', action: togglePagination });
  }

  for (const item of menuItems) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height: 1px; background: #eee; margin: 4px 0;';
      menu.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.style.cssText = `
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 4px;
        font-size: 13px;
      `;
      btn.onmouseenter = () => btn.style.background = '#f0f0f0';
      btn.onmouseleave = () => btn.style.background = 'transparent';
      btn.onclick = async () => {
        menu.style.display = 'none';
        await item.action?.();
      };
      menu.appendChild(btn);
    }
  }

  return menu;
}

// Toggle menu visibility
export function toggleMenu(): void {
  let menu = document.getElementById('ave-context-menu');
  if (!menu) {
    menu = createContextMenu();
    document.body.appendChild(menu);
  }
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Add floating menu button
export function addMenuButton(): void {
  const button = document.createElement('button');
  button.id = 'ave-menu-button';
  button.textContent = '⚙️';
  button.title = 'AVE Script Menu';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: none;
    background: #007bff;
    color: white;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    z-index: 999998;
    transition: transform 0.2s;
  `;
  button.onmouseenter = () => button.style.transform = 'scale(1.1)';
  button.onmouseleave = () => button.style.transform = 'scale(1)';
  button.onclick = toggleMenu;

  document.body.appendChild(button);

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('ave-context-menu');
    const btn = document.getElementById('ave-menu-button');
    if (menu && menu.style.display !== 'none' &&
        e.target !== menu && e.target !== btn &&
        !menu.contains(e.target as Node)) {
      menu.style.display = 'none';
    }
  });
}
