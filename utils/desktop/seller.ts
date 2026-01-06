/**
 * Seller page processing for desktop
 */

import { isUserBlacklisted } from '../state';
import { addUserToBlacklist, removeUserFromBlacklist } from '../blacklist';

const SELLER_PAGE_SIDEBAR_SELECTOR = '[class^="ExtendedProfileStickyContainer-"]';

function checkButton(): boolean {
  // Check if our buttons already exist
  return document.querySelector('[data-marker="ave-block-seller"]') !== null ||
         document.querySelector('[data-marker="ave-unblock-seller"]') !== null;
}

export function insertBlockedSellerUI(userId: string): void {
  if (checkButton()) return;

  const sidebar = document.querySelector(SELLER_PAGE_SIDEBAR_SELECTOR);
  if (!sidebar) return;

  // Find the subscribe button container to copy its structure and classes
  const subscribeContainer = sidebar.querySelector('[class*="SubscribeInfo-module-subscribe"]');
  const existingButton = subscribeContainer?.querySelector('button');

  // Create wrapper div matching the subscribe button container structure
  const wrapperHtml = `
    <div class="ave-seller-button-wrapper" style="margin-top: 8px;">
      <div class="${subscribeContainer?.className || 'SubscribeInfo-module-subscribe-oQO3y'}">
        <button type="button" data-marker="ave-unblock-seller" class="${existingButton?.className || 'styles-module-root-wdGw5 styles-module-root_size_m-jsWyU styles-module-root_preset_secondary-LeVEh styles-module-root_fullWidth-TCOfE'}">
          <span class="${existingButton?.querySelector('span')?.className || 'styles-module-wrapper-z0dri'}">
            <span class="${existingButton?.querySelector('span span')?.className || 'styles-module-text-ImmDp styles-module-text_size_m-WPf25'}">Показать пользователя</span>
          </span>
        </button>
      </div>
    </div>`;

  // Insert badge after the name element
  const nameElement = sidebar.querySelector('[class*="AvatarNameView-module-name"]');
  if (nameElement && !sidebar.querySelector('.ave-blacklist-badge')) {
    const badgeHtml = '<div class="ave-blacklist-badge" style="margin-top: 8px; padding: 4px 8px; background-color: #f8cbcb; border-radius: 4px; font-size: 14px; color: #000;">❌ Пользователь в ЧС</div>';
    nameElement.insertAdjacentHTML('afterend', badgeHtml);
  }

  // Insert button after subscribe button
  if (subscribeContainer) {
    subscribeContainer.insertAdjacentHTML('afterend', wrapperHtml);
  } else {
    sidebar.insertAdjacentHTML('beforeend', wrapperHtml);
  }

  const actionButton = sidebar.querySelector('[data-marker="ave-unblock-seller"]');
  if (actionButton) {
    actionButton.addEventListener('click', async () => {
      await removeUserFromBlacklist(userId);
      const badge = sidebar.querySelector('.ave-blacklist-badge');
      if (badge) badge.remove();
      actionButton.closest('.ave-seller-button-wrapper')?.remove();
      insertSellerUI(userId);
    });
  }
}

export function insertSellerUI(userId: string): void {
  if (checkButton()) return;

  const sidebar = document.querySelector(SELLER_PAGE_SIDEBAR_SELECTOR);
  if (!sidebar) return;

  // Find the subscribe button container to copy its structure and classes
  const subscribeContainer = sidebar.querySelector('[class*="SubscribeInfo-module-subscribe"]');
  const existingButton = subscribeContainer?.querySelector('button');

  // Create wrapper div matching the subscribe button container structure
  const wrapperHtml = `
    <div class="ave-seller-button-wrapper" style="margin-top: 8px;">
      <div class="${subscribeContainer?.className || 'SubscribeInfo-module-subscribe-oQO3y'}">
        <button type="button" data-marker="ave-block-seller" class="${existingButton?.className || 'styles-module-root-wdGw5 styles-module-root_size_m-jsWyU styles-module-root_preset_secondary-LeVEh styles-module-root_fullWidth-TCOfE'}">
          <span class="${existingButton?.querySelector('span')?.className || 'styles-module-wrapper-z0dri'}">
            <span class="${existingButton?.querySelector('span span')?.className || 'styles-module-text-ImmDp styles-module-text_size_m-WPf25'}">Скрыть пользователя</span>
          </span>
        </button>
      </div>
    </div>`;

  // Insert button after subscribe button
  if (subscribeContainer) {
    subscribeContainer.insertAdjacentHTML('afterend', wrapperHtml);
  } else {
    sidebar.insertAdjacentHTML('beforeend', wrapperHtml);
  }

  const actionButton = sidebar.querySelector('[data-marker="ave-block-seller"]');
  if (actionButton) {
    actionButton.addEventListener('click', async () => {
      await addUserToBlacklist(userId);
      actionButton.closest('.ave-seller-button-wrapper')?.remove();
      insertBlockedSellerUI(userId);
    });
  }
}

export function processSellerPage(userId: string): void {
  if (isUserBlacklisted(userId)) {
    insertBlockedSellerUI(userId);
  } else {
    insertSellerUI(userId);
  }
}
