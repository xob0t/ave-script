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

// Helper function (moved up for use in toast)
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toast notification system
type ToastType = 'success' | 'error' | 'info';

const toastIcons: Record<ToastType, string> = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
};

function showToast(type: ToastType, title: string, message?: string): void {
  const container = document.getElementById('toast-container')!;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${toastIcons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${message ? `<div class="toast-message">${escapeHtml(message)}</div>` : ''}
    </div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 150);
  }, 3000);
}

// Modal dialog system
interface ModalOptions {
  title: string;
  message?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  showInput?: boolean;
}

function showModal(options: ModalOptions): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const messageEl = document.getElementById('modal-message')!;
    const inputEl = document.getElementById('modal-input') as HTMLInputElement;
    const confirmBtn = document.getElementById('modal-confirm')!;
    const cancelBtn = document.getElementById('modal-cancel')!;

    titleEl.textContent = options.title;
    messageEl.textContent = options.message || '';
    messageEl.style.display = options.message ? 'block' : 'none';

    if (options.showInput) {
      inputEl.style.display = 'block';
      inputEl.value = options.inputValue || '';
      inputEl.placeholder = options.inputPlaceholder || '';
      setTimeout(() => inputEl.focus(), 50);
    } else {
      inputEl.style.display = 'none';
    }

    confirmBtn.textContent = options.confirmText || 'OK';
    cancelBtn.textContent = options.cancelText || 'Cancel';

    confirmBtn.className = `modal-btn ${options.destructive ? 'destructive' : 'primary'}`;

    const cleanup = () => {
      overlay.classList.remove('active');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      inputEl.removeEventListener('keydown', handleKeydown);
    };

    const handleConfirm = () => {
      cleanup();
      if (options.showInput) {
        resolve(inputEl.value);
      } else {
        resolve(true);
      }
    };

    const handleCancel = () => {
      cleanup();
      resolve(options.showInput ? null : false);
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleConfirm();
      if (e.key === 'Escape') handleCancel();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    inputEl.addEventListener('keydown', handleKeydown);

    overlay.classList.add('active');
  });
}

async function modalAlert(title: string, message?: string): Promise<void> {
  const overlay = document.getElementById('modal-overlay')!;
  const titleEl = document.getElementById('modal-title')!;
  const messageEl = document.getElementById('modal-message')!;
  const inputEl = document.getElementById('modal-input') as HTMLInputElement;
  const confirmBtn = document.getElementById('modal-confirm')!;
  const cancelBtn = document.getElementById('modal-cancel')!;

  titleEl.textContent = title;
  messageEl.textContent = message || '';
  messageEl.style.display = message ? 'block' : 'none';
  inputEl.style.display = 'none';
  confirmBtn.textContent = 'OK';
  confirmBtn.className = 'modal-btn primary';
  cancelBtn.style.display = 'none';

  return new Promise((resolve) => {
    const cleanup = () => {
      overlay.classList.remove('active');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.style.display = '';
    };

    const handleConfirm = () => {
      cleanup();
      resolve();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    overlay.classList.add('active');
  });
}

async function modalConfirm(title: string, message?: string, destructive = false): Promise<boolean> {
  const result = await showModal({
    title,
    message,
    confirmText: destructive ? 'Delete' : 'Confirm',
    destructive,
  });
  return result === true;
}

async function modalPrompt(title: string, message?: string, defaultValue?: string, placeholder?: string): Promise<string | null> {
  const result = await showModal({
    title,
    message,
    showInput: true,
    inputValue: defaultValue,
    inputPlaceholder: placeholder,
  });
  return result as string | null;
}

// Choice modal for sync setup
async function showSyncChoiceModal(): Promise<'create' | 'import' | null> {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay')!;
    const titleEl = document.getElementById('modal-title')!;
    const messageEl = document.getElementById('modal-message')!;
    const inputEl = document.getElementById('modal-input') as HTMLInputElement;
    const confirmBtn = document.getElementById('modal-confirm')!;
    const cancelBtn = document.getElementById('modal-cancel')!;

    titleEl.textContent = 'Enable Cloud Sync';
    messageEl.textContent = 'Choose how to set up sync:';
    messageEl.style.display = 'block';
    inputEl.style.display = 'none';
    confirmBtn.textContent = 'Create new';
    confirmBtn.className = 'modal-btn primary';
    cancelBtn.textContent = 'Import existing';
    cancelBtn.className = 'modal-btn secondary';

    const cleanup = () => {
      overlay.classList.remove('active');
      confirmBtn.removeEventListener('click', handleCreate);
      cancelBtn.removeEventListener('click', handleImport);
      overlay.removeEventListener('click', handleOverlayClick);
    };

    const handleCreate = () => {
      cleanup();
      resolve('create');
    };

    const handleImport = () => {
      cleanup();
      resolve('import');
    };

    const handleOverlayClick = (e: MouseEvent) => {
      if (e.target === overlay) {
        cleanup();
        resolve(null);
      }
    };

    confirmBtn.addEventListener('click', handleCreate);
    cancelBtn.addEventListener('click', handleImport);
    overlay.addEventListener('click', handleOverlayClick);

    overlay.classList.add('active');
  });
}

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
      if (sub && (await modalConfirm('Delete subscription', `Remove "${sub.name}" from your subscriptions?`, true))) {
        const updatedSubs = currentSubs.filter((s) => s.id !== id);
        await subscriptions.setValue(updatedSubs);
        await renderSubscriptionsList();
        await loadStats();
      }
    });
  });
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

  // Sync toggle (enable)
  document.getElementById('toggle-sync')!.addEventListener('click', async () => {
    const choice = await showSyncChoiceModal();
    if (!choice) return;

    if (choice === 'create') {
      const name = await modalPrompt('Create New Sync', 'Enter a name for your blacklist', 'My Blacklist');
      if (!name) return;

      const description = (await modalPrompt('Description', 'Optional description for your list')) || '';

      try {
        const result = (await sendToContentScript('publishToSupabase', { name, description })) as { id: string };
        await updateSyncUI();
        showToast('success', 'Sync enabled', 'Your blacklist will now sync across devices');
        console.log('Published to Supabase:', result.id);
      } catch (error) {
        showToast('error', 'Error', (error as Error).message);
      }
    } else {
      const input = await modalPrompt('Import Sync', 'Paste credentials from another device', '', 'Paste JSON here...');

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
        showToast('error', 'Invalid format', 'Paste the JSON copied from another device');
        return;
      }

      try {
        const result = (await sendToContentScript('importEditableList', { listId, editCode })) as {
          name: string;
          users: number;
          offers: number;
        };

        await updateSyncUI();
        showToast('success', 'Sync connected', `${result.name}: ${result.users} sellers, ${result.offers} listings`);

        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          browser.tabs.reload(tab.id);
        }
      } catch (error) {
        showToast('error', 'Error', (error as Error).message);
      }
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
      showToast('success', 'Copied', 'Paste on another device to connect');
    } catch {
      await modalAlert('Copy credentials', credentialsJSON);
    }
  });

  // Force sync
  document.getElementById('btn-force-sync')!.addEventListener('click', async () => {
    try {
      const result = (await sendToContentScript('forceSync')) as { users: number; offers: number };
      showToast('success', 'Sync complete', `${result.users} sellers, ${result.offers} listings`);
      await loadStats();
    } catch (error) {
      showToast('error', 'Error', (error as Error).message);
    }
  });

  // Sync toggle (disable)
  document.getElementById('toggle-sync-off')!.addEventListener('click', async () => {
    if (!(await modalConfirm('Disable sync', 'Your local data will be kept, but changes won\'t sync to the cloud anymore.'))) {
      return;
    }

    await publishedListId.setValue(null);
    await publishedEditCode.setValue(null);
    await updateSyncUI();
    showToast('info', 'Sync disabled', 'Your local blacklist is still available');
  });

  // Add subscription
  document.getElementById('btn-add-subscription')!.addEventListener('click', async () => {
    const listId = await modalPrompt('Add Subscription', 'Enter List ID (read-only subscription)', '', 'List ID...');

    if (!listId || !listId.trim()) return;

    try {
      const result = (await sendToContentScript('subscribeToList', { listId: listId.trim() })) as {
        name: string;
        description: string;
        users: number;
        offers: number;
      };

      showToast('success', 'Subscribed', `${result.name}: ${result.users} sellers, ${result.offers} listings`);

      await renderSubscriptionsList();
      await loadStats();
    } catch (error) {
      showToast('error', 'Error', (error as Error).message);
    }
  });

  // Export
  document.getElementById('btn-export')!.addEventListener('click', async () => {
    try {
      await sendToContentScript('exportDatabase');
      showToast('success', 'Exported', 'Database saved to file');
    } catch (error) {
      showToast('error', 'Error', (error as Error).message);
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
          showToast('success', 'Import successful', 'Database has been restored');

          const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            browser.tabs.reload(tab.id);
          }
        } catch (error) {
          showToast('error', 'Error', (error as Error).message);
        }
      };
      reader.onerror = () => {
        showToast('error', 'Error', 'Failed to read file');
      };
      reader.readAsText(file);
    };

    input.click();
  });

  // Clear database
  document.getElementById('btn-clear')!.addEventListener('click', async () => {
    if (await modalConfirm('Clear all data', 'This action cannot be undone. All your blacklist data will be permanently deleted.', true)) {
      try {
        await sendToContentScript('clearDatabase');
        showToast('success', 'Cleared', 'All data has been removed');

        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          browser.tabs.reload(tab.id);
        }
      } catch (error) {
        showToast('error', 'Error', (error as Error).message);
      }
    }
  });

  // Debug
  document.getElementById('btn-debug')!.addEventListener('click', async () => {
    try {
      await sendToContentScript('debugSyncState');
      showToast('info', 'Debug logged', 'Open F12 on avito.ru to view');
    } catch (error) {
      showToast('error', 'Error', (error as Error).message);
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
      'toggle-sync',
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
