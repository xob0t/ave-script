/**
 * Search page processing for desktop
 */

import { catalogData, isUserBlacklisted, isOfferBlacklisted } from '../state';
import { getOfferId, extractUserIdFromCatalogData } from './parser';
import { createHiddenContainer, updateHiddenCounter } from '../hidden-container';
import {
  insertBlockSellerButton,
  insertBlockOfferButton,
  insertUnblockSellerButton,
  insertUnblockOfferButton,
  type OfferInfo
} from '../buttons';

const OFFERS_SELECTOR = '[data-marker="item"]';
const LOG_PREFIX = '[ave]';

export function updateOfferState(offerElement: Element, offerInfo: OfferInfo): void {
  const hiddenContainer = createHiddenContainer();
  if (!hiddenContainer) return;

  const offerIsHidden = hiddenContainer.contains(offerElement);
  const userIsBlacklisted = offerInfo?.userId ? isUserBlacklisted(offerInfo.userId) : false;
  const offerIsBlacklisted = offerInfo?.offerId ? isOfferBlacklisted(offerInfo.offerId) : false;

  // Helper to add buttons to an element
  const addButtons = (element: Element): void => {
    // Remove existing button container if any
    const existingContainer = element.querySelector('.button-container');
    if (existingContainer) existingContainer.remove();

    const refreshCallback = () => processSearchPage();

    if (offerInfo.userId) {
      if (userIsBlacklisted) {
        insertUnblockSellerButton(element, offerInfo, refreshCallback);
      } else {
        insertBlockSellerButton(element, offerInfo, refreshCallback);
      }
    }

    if (offerIsBlacklisted) {
      insertUnblockOfferButton(element, offerInfo, refreshCallback);
    } else {
      insertBlockOfferButton(element, offerInfo, refreshCallback);
    }
  };

  if (!offerIsHidden && (userIsBlacklisted || offerIsBlacklisted)) {
    // Clone the original offer
    const offerElementClone = offerElement.cloneNode(true) as Element;
    // Mark clone so we can distinguish it from original
    offerElementClone.setAttribute('data-ave-clone', 'true');
    // Add buttons to clone BEFORE appending to hidden container
    addButtons(offerElementClone);
    // Hide the original offer
    (offerElement as HTMLElement).style.display = 'none';
    offerElement.setAttribute('data-ave-hidden', 'true');
    // Put clone in hidden container
    hiddenContainer.appendChild(offerElementClone);
    console.log(`${LOG_PREFIX} offer ${offerInfo.offerId} hidden`);
    return; // Don't add buttons to original (it's hidden)
  } else if (offerIsHidden && !userIsBlacklisted && !offerIsBlacklisted) {
    // Remove clone from hidden container
    offerElement.remove();
    // Find the original hidden offer (marked with data-ave-hidden)
    const originalOffer = document.querySelector(`[data-item-id="${offerInfo.offerId}"][data-ave-hidden="true"]`);
    if (originalOffer) {
      (originalOffer as HTMLElement).style.display = '';
      originalOffer.removeAttribute('data-ave-hidden');
      addButtons(originalOffer);
      console.log(`${LOG_PREFIX} offer ${offerInfo.offerId} restored`);
    }
    return;
  } else if (offerIsHidden && (userIsBlacklisted || offerIsBlacklisted)) {
    // Already hidden and still blacklisted - just update buttons
    addButtons(offerElement);
    return;
  }

  if (!offerElement) return;

  // Add buttons to the visible offer
  addButtons(offerElement);
}

export function processSearchPage(): void {
  const hiddenContainer = createHiddenContainer();
  const offerElements = document.querySelectorAll(OFFERS_SELECTOR);
  console.log(`${LOG_PREFIX} Processing ${offerElements.length} offers`);

  // First, check hidden container for clones - restore or update buttons
  if (hiddenContainer) {
    const clonedOffers = hiddenContainer.querySelectorAll('[data-ave-clone="true"]');
    for (const clonedOffer of clonedOffers) {
      const offerId = getOfferId(clonedOffer);
      if (!offerId) continue;

      const userId = extractUserIdFromCatalogData(catalogData, offerId);
      updateOfferState(clonedOffer, { offerId, userId: userId || undefined });
    }
  }

  // Then process visible offers
  for (const offerElement of offerElements) {
    const offerId = getOfferId(offerElement);
    if (!offerId) continue;

    // Skip offers in the hidden container (handled above)
    if (hiddenContainer && hiddenContainer.contains(offerElement)) continue;

    // Skip offers that are already hidden (their clone is in the hidden container)
    if (offerElement.getAttribute('data-ave-hidden') === 'true') continue;

    const userId = extractUserIdFromCatalogData(catalogData, offerId);
    const userIsBlacklisted = userId ? isUserBlacklisted(userId) : false;
    const offerIsBlacklisted = offerId ? isOfferBlacklisted(offerId) : false;

    // Check if this element already has buttons
    const hasButtons = offerElement.querySelector('.button-container');

    // If offer should be hidden (seller or offer blacklisted), always process it
    // Otherwise, skip if already has buttons
    if (hasButtons && !userIsBlacklisted && !offerIsBlacklisted) continue;

    updateOfferState(offerElement, { offerId, userId: userId || undefined });
  }

  // Update counter in hidden container header
  updateHiddenCounter();
}
