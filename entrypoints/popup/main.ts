/**
 * Popup script for AVE Script browser extension
 */

import { storage } from 'wxt/storage';

// Storage items (must match utils/storage.ts)
const paginationEnabled = storage.defineItem<boolean>('local:paginationEnabled', { fallback: false });
const publishedListId = storage.defineItem<string | null>('local:publishedListId', { fallback: null });
const publishedEditCode = storage.defineItem<string | null>('local:publishedEditCode', { fallback: null });
const subscriptionsEnabled = storage.defineItem<boolean>('local:subscriptionsEnabled', { fallback: true });

interface Subscription {
  id: string;
  name: string;
  enabled: boolean;
  lastSynced: number | null;
}

const subscriptions = storage.defineItem<Subscription[]>('local:subscriptions', { fallback: [] });

let isOnAvito = false;

// View management
function showView(viewId: string): void {
  for (const v of document.querySelectorAll('.view')) {
    v.classList.remove('active');
  }
  document.getElementById(viewId)?.classList.add('active');
}

// Helper to send message to content script
async function sendToContentScript(action: string, data?: unknown): Promise<unknown> {
  if (!isOnAvito) {
    throw new Error('Please open avito.ru first');
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error('No active tab found');
  }

  try {
    return await browser.tabs.sendMessage(tab.id, { action, data });
  } catch (error) {
    // Handle "Receiving end does not exist" error
    const msg = (error as Error).message || '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      throw new Error('Refresh avito.ru page and try again');
    }
    throw error;
  }
}

// Load and display stats
async function loadStats(): Promise<void> {
  try {
    if (isOnAvito) {
      const result = (await sendToContentScript('getStats')) as { users: number; offers: number } | null;
      if (result) {
        document.getElementById('stat-users')!.textContent = String(result.users);
        document.getElementById('stat-offers')!.textContent = String(result.offers);
      }
    }
  } catch {
    document.getElementById('stat-users')!.textContent = '-';
    document.getElementById('stat-offers')!.textContent = '-';
  }

  const subs = await subscriptions.getValue();
  document.getElementById('stat-subs')!.textContent = String(subs.length);
  document.getElementById('badge-subs')!.textContent = String(subs.length);
}

// Initialize pagination toggle
async function initPaginationToggle(): Promise<void> {
  const toggle = document.getElementById('toggle-pagination')!;
  const enabled = await paginationEnabled.getValue();

  if (enabled) {
    toggle.classList.add('active');
  }

  document.getElementById('btn-pagination')!.addEventListener('click', async () => {
    const current = await paginationEnabled.getValue();
    await paginationEnabled.setValue(!current);
    toggle.classList.toggle('active');

    if (isOnAvito) {
      try {
        await sendToContentScript('togglePagination', !current);
      } catch {
        // Ignore
      }
    }
  });
}

// Initialize subscriptions toggle
async function initSubscriptionsToggle(): Promise<void> {
  const toggle = document.getElementById('toggle-subs')!;
  const enabled = await subscriptionsEnabled.getValue();

  if (enabled) {
    toggle.classList.add('active');
  }

  document.getElementById('btn-subs-toggle')!.addEventListener('click', async () => {
    const current = await subscriptionsEnabled.getValue();
    await subscriptionsEnabled.setValue(!current);
    toggle.classList.toggle('active');
  });
}

// Render subscriptions list
async function renderSubscriptionsList(): Promise<void> {
  const subs = await subscriptions.getValue();
  const listEl = document.getElementById('subs-list')!;
  const emptyEl = document.getElementById('subs-empty')!;

  if (subs.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  listEl.innerHTML = subs
    .map(
      (sub) => `
    <div class="sub-item" data-id="${sub.id}">
      <div class="sub-info">
        <div class="sub-name">${escapeHtml(sub.name)}</div>
        <div class="sub-meta">${sub.id.substring(0, 8)}... • ${sub.lastSynced ? formatDate(sub.lastSynced) : 'Never synced'}</div>
      </div>
      <div class="sub-actions">
        <div class="toggle-switch sub-toggle ${sub.enabled ? 'active' : ''}" data-id="${sub.id}"></div>
        <div class="sub-delete" data-id="${sub.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </div>
      </div>
    </div>
  `,
    )
    .join('');

  // Add event listeners for toggles
  listEl.querySelectorAll('.sub-toggle').forEach((toggle) => {
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (toggle as HTMLElement).dataset.id!;
      const currentSubs = await subscriptions.getValue();
      const updatedSubs = currentSubs.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      await subscriptions.setValue(updatedSubs);
      toggle.classList.toggle('active');
    });
  });

  // Add event listeners for delete buttons
  listEl.querySelectorAll('.sub-delete').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id!;
      const currentSubs = await subscriptions.getValue();
      const sub = currentSubs.find((s) => s.id === id);
      if (sub && confirm(`Delete subscription "${sub.name}"?`)) {
        const updatedSubs = currentSubs.filter((s) => s.id !== id);
        await subscriptions.setValue(updatedSubs);
        await renderSubscriptionsList();
        await loadStats();
      }
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

// Update sync UI based on current state
async function updateSyncUI(): Promise<void> {
  const listId = await publishedListId.getValue();
  const syncDisabledEl = document.getElementById('sync-disabled')!;
  const syncEnabledEl = document.getElementById('sync-enabled')!;
  const syncListIdEl = document.getElementById('sync-list-id')!;

  if (listId) {
    syncDisabledEl.style.display = 'none';
    syncEnabledEl.style.display = 'block';
    syncListIdEl.textContent = `ID: ${listId.substring(0, 8)}...`;
  } else {
    syncDisabledEl.style.display = 'block';
    syncEnabledEl.style.display = 'none';
  }
}

// Setup menu button handlers
function setupMenuHandlers(): void {
  // View navigation
  document.getElementById('btn-open-subs')!.addEventListener('click', async () => {
    await renderSubscriptionsList();
    showView('view-subs');
  });

  document.getElementById('btn-subs-back')!.addEventListener('click', () => {
    showView('view-main');
  });

  document.getElementById('btn-open-data')!.addEventListener('click', () => {
    showView('view-data');
  });

  document.getElementById('btn-data-back')!.addEventListener('click', () => {
    showView('view-main');
  });

  // Create new sync
  document.getElementById('btn-create-sync')!.addEventListener('click', async () => {
    const name = prompt('Create New Sync\n\nEnter list name:', 'My Blacklist');
    if (!name) return;

    const description = prompt('Description (optional):') || '';

    try {
      const result = (await sendToContentScript('publishToSupabase', { name, description })) as { id: string };
      await updateSyncUI();
      alert('Sync enabled!\n\nYour blacklist will now sync across devices.');
      console.log('Published to Supabase:', result.id);
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });

  // Import existing sync
  document.getElementById('btn-import-sync')!.addEventListener('click', async () => {
    const input = prompt('Import Sync\n\nPaste credentials from another device:');

    if (!input || !input.trim()) return;

    let listId: string, editCode: string;

    try {
      const parsed = JSON.parse(input.trim()) as { listId?: string; editCode?: string };
      if (!parsed.listId || !parsed.editCode) {
        throw new Error('Invalid format');
      }
      listId = parsed.listId;
      editCode = parsed.editCode;
    } catch {
      alert('Invalid credentials format.\n\nPaste the JSON copied from another device.');
      return;
    }

    try {
      const result = (await sendToContentScript('importEditableList', { listId, editCode })) as {
        name: string;
        users: number;
        offers: number;
      };

      await updateSyncUI();
      alert(`Sync connected!\n\nList: ${result.name}\nSellers: ${result.users}\nListings: ${result.offers}`);

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        browser.tabs.reload(tab.id);
      }
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });

  // Copy credentials
  document.getElementById('btn-copy-credentials')!.addEventListener('click', async () => {
    const listId = await publishedListId.getValue();
    const editCode = await publishedEditCode.getValue();

    if (!listId || !editCode) return;

    const credentialsJSON = JSON.stringify({ listId, editCode });

    try {
      await navigator.clipboard.writeText(credentialsJSON);
      alert('Credentials copied!\n\nPaste on another device to connect.');
    } catch {
      prompt('Copy credentials:', credentialsJSON);
    }
  });

  // Force sync
  document.getElementById('btn-force-sync')!.addEventListener('click', async () => {
    try {
      const result = (await sendToContentScript('forceSync')) as { users: number; offers: number };
      alert(`Sync complete!\n\nSellers: ${result.users}\nListings: ${result.offers}`);
      await loadStats();
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });

  // Disable sync
  document.getElementById('btn-disable-sync')!.addEventListener('click', async () => {
    if (!confirm('Disable sync?\n\nYour local data will be kept, but changes won\'t sync to the cloud anymore.')) {
      return;
    }

    await publishedListId.setValue(null);
    await publishedEditCode.setValue(null);
    await updateSyncUI();
    alert('Sync disabled.\n\nYour local blacklist is still available.');
  });

  // Add subscription
  document.getElementById('btn-add-subscription')!.addEventListener('click', async () => {
    const listId = prompt('Add Subscription\n\nEnter List ID:\n\nThis is a read-only subscription.');

    if (!listId || !listId.trim()) return;

    try {
      const result = (await sendToContentScript('subscribeToList', { listId: listId.trim() })) as {
        name: string;
        description: string;
        users: number;
        offers: number;
      };

      alert(`Subscribed!\n\nName: ${result.name}\nSellers: ${result.users}\nListings: ${result.offers}`);

      await renderSubscriptionsList();
      await loadStats();
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });

  // Export
  document.getElementById('btn-export')!.addEventListener('click', async () => {
    try {
      await sendToContentScript('exportDatabase');
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });

  // Import
  document.getElementById('btn-import')!.addEventListener('click', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const jsonText = event.target?.result as string;
          await sendToContentScript('importDatabase', { jsonText });
          alert('Import successful!');

          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            browser.tabs.reload(tab.id);
          }
        } catch (error) {
          alert(`Error: ${(error as Error).message}`);
        }
      };
      reader.onerror = () => {
        alert('Error reading file');
      };
      reader.readAsText(file);
    };

    input.click();
  });

  // Clear database
  document.getElementById('btn-clear')!.addEventListener('click', async () => {
    if (confirm('Clear all data?\n\nThis cannot be undone.')) {
      try {
        await sendToContentScript('clearDatabase');
        alert('Database cleared!');

        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          browser.tabs.reload(tab.id);
        }
      } catch (error) {
        alert(`Error: ${(error as Error).message}`);
      }
    }
  });

  // Debug
  document.getElementById('btn-debug')!.addEventListener('click', async () => {
    try {
      await sendToContentScript('debugSyncState');
      alert('Debug info logged to console.\n\nOpen F12 on avito.ru to view.');
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    }
  });
}

// Check if we're on an Avito page
async function checkAvitoPage(): Promise<boolean> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      return tab.url.includes('avito.ru');
    }
  } catch {
    // Ignore
  }
  return false;
}

// Initialize popup
async function init(): Promise<void> {
  isOnAvito = await checkAvitoPage();

  if (!isOnAvito) {
    document.getElementById('not-avito-notice')!.style.display = 'flex';

    // Disable buttons that require content script
    const contentScriptButtons = [
      'btn-export',
      'btn-import',
      'btn-clear',
      'btn-debug',
      'btn-force-sync',
      'btn-create-sync',
      'btn-import-sync',
      'btn-add-subscription',
    ];

    for (const id of contentScriptButtons) {
      const btn = document.getElementById(id);
      if (btn) {
        btn.classList.add('disabled');
        btn.style.pointerEvents = 'none';
      }
    }
  }

  await loadStats();
  await initPaginationToggle();
  await initSubscriptionsToggle();
  await updateSyncUI();
  setupMenuHandlers();
}

// Run on load
document.addEventListener('DOMContentLoaded', init);
