/**
 * Userscript menu using GM_registerMenuCommand
 */

import { getAllUsers, getAllOffers, exportAll, importAll, clearAll } from '../utils/db';
import {
  isPaginationEnabled,
  setPaginationEnabled,
  setBlacklistUsers,
  setBlacklistOffers,
  getPublishedListId,
  getPublishedEditCode,
  setPublishedListId,
  setPublishedEditCode,
  getEnabledSubscriptions,
  getSubscriptions,
  addSubscription,
  removeSubscription,
  toggleSubscription,
  markLocalChange,
} from './state';
import { publishToSupabase, subscribeToList, importEditableList } from '../utils/sync';
import { forceSyncNow } from '../utils/periodic-sync';
import { fetchList } from '../utils/supabase';
import { checkPaginationVisibility } from '../utils/desktop/pagination';

declare function GM_registerMenuCommand(caption: string, commandFunc: () => void): void;

const LOG_PREFIX = '[ave]';
const isMobile = typeof window !== 'undefined' && window.location.hostname === 'm.avito.ru';

export function registerMenuCommands(): void {
  // Stats
  GM_registerMenuCommand('📊 Статистика', showStats);

  // Pagination toggle (desktop only)
  if (!isMobile) {
    GM_registerMenuCommand('📄 Авто-пагинация', togglePagination);
  }

  // Sync commands
  GM_registerMenuCommand('☁️ Включить синхронизацию', enableSync);
  GM_registerMenuCommand('☁️ Получить данные синхронизации', getSyncData);
  GM_registerMenuCommand('☁️ Подключить синхронизацию', connectSync);
  GM_registerMenuCommand('🔄 Синхронизировать сейчас', forceSync);

  // Subscriptions
  GM_registerMenuCommand('📋 Подписаться на список', addNewSubscription);
  GM_registerMenuCommand('📋 Управление подписками', manageSubscriptions);

  // Data management
  GM_registerMenuCommand('💾 Экспорт базы данных', exportDatabase);
  GM_registerMenuCommand('📥 Импорт базы данных', importDatabase);
  GM_registerMenuCommand('🗑️ Очистить базу данных', clearDatabase);

  // Debug
  GM_registerMenuCommand('🔧 Debug: Sync State', debugSyncState);
}

async function showStats(): Promise<void> {
  const users = await getAllUsers();
  const offers = await getAllOffers();
  const subs = getEnabledSubscriptions();

  alert(`📊 Статистика AVE Script\n\n` +
    `Заблокированных продавцов: ${users.length}\n` +
    `Заблокированных объявлений: ${offers.length}\n` +
    `Активных подписок: ${subs.length}`);
}

async function togglePagination(): Promise<void> {
  const current = isPaginationEnabled();
  const newValue = !current;
  await setPaginationEnabled(newValue);

  if (newValue) {
    checkPaginationVisibility();
  }

  alert(`Авто-пагинация ${newValue ? 'включена' : 'выключена'}`);
}

async function enableSync(): Promise<void> {
  const existingId = getPublishedListId();
  if (existingId) {
    const confirm = window.confirm('Синхронизация уже настроена. Создать новый список?');
    if (!confirm) return;
  }

  const name = prompt('Введите название списка:');
  if (!name) return;

  const description = prompt('Введите описание (необязательно):') || '';

  try {
    const result = await publishToSupabase(name, description);
    if (result.listId && result.editCode) {
      alert(`✅ Синхронизация включена!\n\nList ID: ${result.listId}\n\nИспользуйте "Получить данные синхронизации" для копирования данных.`);
    }
  } catch (error) {
    alert(`❌ Ошибка: ${(error as Error).message}`);
  }
}

async function getSyncData(): Promise<void> {
  const listId = getPublishedListId();
  const editCode = getPublishedEditCode();

  if (!listId || !editCode) {
    alert('❌ Сначала включите синхронизацию');
    return;
  }

  const data = JSON.stringify({ listId, editCode });
  await navigator.clipboard.writeText(data);
  alert('✅ Данные скопированы в буфер обмена');
}

async function connectSync(): Promise<void> {
  const json = prompt('Вставьте JSON с данными синхронизации:');
  if (!json) return;

  try {
    const data = JSON.parse(json) as { listId?: string; editCode?: string };
    if (!data.listId || !data.editCode) {
      throw new Error('Неверный формат данных');
    }

    await importEditableList(data.listId, data.editCode);
    await forceSyncNow();
    alert('✅ Синхронизация подключена!');
  } catch (error) {
    alert(`❌ Ошибка: ${(error as Error).message}`);
  }
}

async function forceSync(): Promise<void> {
  try {
    const result = await forceSyncNow();
    alert(`✅ Синхронизация завершена\n\nПользователей: ${result.users}\nОбъявлений: ${result.offers}`);
  } catch (error) {
    alert(`❌ Ошибка синхронизации: ${(error as Error).message}`);
  }
}

async function addNewSubscription(): Promise<void> {
  const listId = prompt('Введите List ID для подписки:');
  if (!listId) return;

  try {
    await subscribeToList(listId);
    await forceSyncNow();
    alert('✅ Подписка добавлена!');
  } catch (error) {
    alert(`❌ Ошибка: ${(error as Error).message}`);
  }
}

async function manageSubscriptions(): Promise<void> {
  const subs = getSubscriptions();

  if (subs.length === 0) {
    alert('Нет активных подписок');
    return;
  }

  let message = '📋 Подписки:\n\n';
  subs.forEach((sub, index) => {
    const status = sub.enabled ? '✅' : '❌';
    message += `${index + 1}. ${status} ${sub.name} (${sub.id.slice(0, 8)}...)\n`;
  });

  message += '\nВведите номер для переключения или "d1" для удаления:';

  const input = prompt(message);
  if (!input) return;

  if (input.startsWith('d')) {
    const index = parseInt(input.slice(1)) - 1;
    if (index >= 0 && index < subs.length) {
      await removeSubscription(subs[index].id);
      alert('✅ Подписка удалена');
    }
  } else {
    const index = parseInt(input) - 1;
    if (index >= 0 && index < subs.length) {
      await toggleSubscription(subs[index].id);
      alert(`✅ Подписка ${subs[index].enabled ? 'выключена' : 'включена'}`);
    }
  }
}

async function exportDatabase(): Promise<void> {
  try {
    const data = await exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'avito_blacklist_database.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(`❌ Ошибка экспорта: ${(error as Error).message}`);
  }
}

async function importDatabase(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as { users?: string[]; offers?: string[] };

      if (!data.users && !data.offers) {
        throw new Error('Неверный формат файла');
      }

      await importAll(data);
      await markLocalChange();

      const users = await getAllUsers();
      const offers = await getAllOffers();
      setBlacklistUsers(users);
      setBlacklistOffers(offers);

      alert(`✅ Импорт завершен\n\nПользователей: ${users.length}\nОбъявлений: ${offers.length}`);
    } catch (error) {
      alert(`❌ Ошибка импорта: ${(error as Error).message}`);
    }
  };

  input.click();
}

async function clearDatabase(): Promise<void> {
  const confirm = window.confirm('⚠️ Вы уверены? Все данные будут удалены!');
  if (!confirm) return;

  try {
    await clearAll();
    await markLocalChange();
    setBlacklistUsers([]);
    setBlacklistOffers([]);
    alert('✅ База данных очищена');
  } catch (error) {
    alert(`❌ Ошибка: ${(error as Error).message}`);
  }
}

async function debugSyncState(): Promise<void> {
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
      console.log(`  Users: ${remoteList.users.length}`, remoteList.users);
      console.log(`  Offers: ${remoteList.offers.length}`, remoteList.offers);
    } catch (error) {
      console.error('  ❌ Failed to fetch remote list:', (error as Error).message);
    }
  } else {
    console.log('  Not published');
  }

  const subs = getEnabledSubscriptions();
  console.log('\n📥 SUBSCRIPTIONS:', subs.length);

  console.log('\n=== END DEBUG STATE ===');
  alert('Debug info logged to console (F12)');
}
