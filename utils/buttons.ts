/**
 * UI buttons for blocking/unblocking sellers and offers
 */

import { addUserToBlacklist, removeUserFromBlacklist, addOfferToBlacklist, removeOfferFromBlacklist } from './blacklist';

const SVG_BLOCK_USER = '<svg xmlns="http://www.w3.org/2000/svg" class="custom-button block block-user-button" role="img" aria-label="user x" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h3.5"></path><path d="M22 22l-5 -5"></path><path d="M17 22l5 -5"></path></svg>';

const SVG_BLOCK_OFFER = '<svg xmlns="http://www.w3.org/2000/svg" class="custom-button block block-item-button" role="img" aria-label="eye x" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"></path><path d="M13.048 17.942a9.298 9.298 0 0 1 -1.048 .058c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6a17.986 17.986 0 0 1 -1.362 1.975"></path><path d="M22 22l-5 -5"></path><path d="M17 22l5 -5"></path></svg>';

const SVG_UNBLOCK_USER = '<svg xmlns="http://www.w3.org/2000/svg" class="custom-button unblock unblock-user-button" role="img" aria-label="user check" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"></path><path d="M6 21v-2a4 4 0 0 1 4 -4h4"></path><path d="M15 19l2 2l4 -4"></path></svg>';

const SVG_UNBLOCK_OFFER = '<svg xmlns="http://www.w3.org/2000/svg" class="custom-button unblock unblock-offer-button" role="img" aria-label="eye check" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"></path><path d="M11.102 17.957c-3.204 -.307 -5.904 -2.294 -8.102 -5.957c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6a19.5 19.5 0 0 1 -.663 1.032"></path><path d="M15 19l2 2l4 -4"></path></svg>';

export interface OfferInfo {
  offerId?: string;
  userId?: string;
}

export function insertButtonContainer(offerElement: Element): HTMLDivElement {
  const container = document.createElement('div');
  container.classList.add('button-container');
  offerElement.appendChild(container);
  return container;
}

export function insertBlockSellerButton(
  offerElement: Element,
  offerInfo: OfferInfo,
  onComplete?: () => void
): void {
  let buttonContainer = offerElement.querySelector('.button-container') as HTMLDivElement | null;
  if (!buttonContainer) {
    buttonContainer = insertButtonContainer(offerElement);
  }

  const blockButton = document.createElement('div');
  blockButton.title = 'Скрыть все объявления продавца';
  blockButton.insertAdjacentHTML('beforeend', SVG_BLOCK_USER);
  buttonContainer.appendChild(blockButton);

  blockButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (offerInfo.userId) {
      await addUserToBlacklist(offerInfo.userId);
      buttonContainer?.remove();
      if (onComplete) onComplete();
    }
  });
}

export function insertBlockOfferButton(
  offerElement: Element,
  offerInfo: OfferInfo,
  onComplete?: () => void
): void {
  let buttonContainer = offerElement.querySelector('.button-container') as HTMLDivElement | null;
  if (!buttonContainer) {
    buttonContainer = insertButtonContainer(offerElement);
  }

  const blockButton = document.createElement('div');
  blockButton.title = 'Скрыть это объявление';
  blockButton.insertAdjacentHTML('beforeend', SVG_BLOCK_OFFER);
  buttonContainer.appendChild(blockButton);

  blockButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (offerInfo.offerId) {
      await addOfferToBlacklist(offerInfo.offerId);
      buttonContainer?.remove();
      if (onComplete) onComplete();
    }
  });
}

export function insertUnblockSellerButton(
  offerElement: Element,
  offerInfo: OfferInfo,
  onComplete?: () => void
): void {
  let buttonContainer = offerElement.querySelector('.button-container') as HTMLDivElement | null;
  if (!buttonContainer) {
    buttonContainer = insertButtonContainer(offerElement);
  }

  const blockButton = document.createElement('div');
  blockButton.title = 'Удалить продавца из черного списка';
  blockButton.insertAdjacentHTML('beforeend', SVG_UNBLOCK_USER);
  buttonContainer.appendChild(blockButton);

  blockButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (offerInfo.userId) {
      await removeUserFromBlacklist(offerInfo.userId);
      buttonContainer?.remove();
      if (onComplete) onComplete();
    }
  });
}

export function insertUnblockOfferButton(
  offerElement: Element,
  offerInfo: OfferInfo,
  onComplete?: () => void
): void {
  let buttonContainer = offerElement.querySelector('.button-container') as HTMLDivElement | null;
  if (!buttonContainer) {
    buttonContainer = insertButtonContainer(offerElement);
  }

  const blockButton = document.createElement('div');
  blockButton.title = 'Удалить это объявление из черного списка';
  blockButton.insertAdjacentHTML('beforeend', SVG_UNBLOCK_OFFER);
  buttonContainer.appendChild(blockButton);

  blockButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (offerInfo.offerId) {
      await removeOfferFromBlacklist(offerInfo.offerId);
      buttonContainer?.remove();
      if (onComplete) onComplete();
    }
  });
}
