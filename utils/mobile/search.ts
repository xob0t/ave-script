/**
 * Search page processing for mobile
 */

import { mobileCatalogData, isUserBlacklisted, isOfferBlacklisted } from '../state';
import { extractUserIdFromMobileData, fetchMobileCatalogIfNeeded } from './parser';
import { createHiddenContainer, updateHiddenCounter } from '../hidden-container';
import {
  insertBlockSellerButton,
  insertBlockOfferButton,
  insertUnblockSellerButton,
  insertUnblockOfferButton,
  type OfferInfo
} from '../buttons';

const LOG_PREFIX = '[ave]';

// Mobile uses different selectors - we need to find item cards
// Common patterns: data-marker="item", data-item-id, or class-based selectors
const MOBILE_OFFERS_SELECTORS = [
  '[data-marker="item"]',
  '[data-item-id]',
  'a[href*="_"][class*="item"]'
];

function findOfferElements(): Element[] {
  for (const selector of MOBILE_OFFERS_SELECTORS) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      return Array.from(elements);
    }
  }

  // Fallback: Find links that look like item links
  const allLinks = document.querySelectorAll('a[href]');
  const itemLinks = Array.from(allLinks).filter(link => {
    const href = link.getAttribute('href');
    // Match item URLs like /category/item-title_1234567890
    return href && /_\d{8,}/.test(href) && !href.includes('/user/');
  });

  if (itemLinks.length > 0) {
    console.log(`${LOG_PREFIX} Found ${itemLinks.length} offers via link pattern`);
    // Return parent elements that might be the card containers
    return itemLinks.map(link => {
      // Find a reasonable parent container
      let parent = link.parentElement;
      for (let i = 0; i < 5 && parent; i++) {
        if (parent.tagName === 'ARTICLE' || parent.tagName === 'LI' ||
            parent.getAttribute('data-marker') === 'item' ||
            parent.getAttribute('data-item-id')) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return link.parentElement!;
    });
  }

  return [];
}

function getOfferIdFromElement(element: Element): string | null {
  // Try data-item-id first
  let offerId = element.getAttribute('data-item-id');
  if (offerId) return offerId;

  // Try child with data-item-id
  const childWithId = element.querySelector('[data-item-id]');
  if (childWithId) {
    offerId = childWithId.getAttribute('data-item-id');
    if (offerId) return offerId;
  }

  // Extract from link href
  const link = element.querySelector('a[href]') as HTMLAnchorElement | null || (element.tagName === 'A' ? element as HTMLAnchorElement : null);
  if (link) {
    const href = link.getAttribute('href');
    // Match pattern like _1234567890
    const match = href?.match(/_(\d{8,})(?:\?|$)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export function updateMobileOfferState(offerElement: Element, offerInfo: OfferInfo): void {
  const hiddenContainer = createHiddenContainer();
  if (!hiddenContainer) {
    console.log(`${LOG_PREFIX} No hidden container found`);
    return;
  }

  const offerIsHidden = hiddenContainer.contains(offerElement);
  const userIsBlacklisted = offerInfo?.userId ? isUserBlacklisted(offerInfo.userId) : false;
  const offerIsBlacklisted = offerInfo?.offerId ? isOfferBlacklisted(offerInfo.offerId) : false;

  // Helper to add buttons to an element
  const addButtons = (element: Element): void => {
    // Remove existing button container if any
    const existingContainer = element.querySelector('.button-container');
    if (existingContainer) existingContainer.remove();

    const refreshCallback = () => processMobileSearchPage();

    // Add seller block/unblock button if we have userId
    if (offerInfo.userId) {
      if (userIsBlacklisted) {
        insertUnblockSellerButton(element, offerInfo, refreshCallback);
      } else {
        insertBlockSellerButton(element, offerInfo, refreshCallback);
      }
    }

    // Always add offer block/unblock button
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

    // Hide the original offer AND its wrapper
    (offerElement as HTMLElement).style.display = 'none';
    offerElement.setAttribute('data-ave-hidden', 'true');

    // Also hide the wrapper div (data-marker="item-wrapper(...)")
    const wrapper = offerElement.closest('[data-marker^="item-wrapper"]');
    if (wrapper) {
      (wrapper as HTMLElement).style.display = 'none';
      wrapper.setAttribute('data-ave-wrapper-hidden', 'true');
    }

    // Put clone in hidden container
    hiddenContainer.appendChild(offerElementClone);
    console.log(`${LOG_PREFIX} offer ${offerInfo.offerId} hidden`);
    return; // Don't add buttons to original (it's hidden)
  } else if (offerIsHidden && !userIsBlacklisted && !offerIsBlacklisted) {
    // Remove clone from hidden container
    offerElement.remove();
    // Find the original hidden offer (marked with data-ave-hidden)
    // Need to search through all hidden offers since they might not have data-item-id attribute
    const hiddenOffers = document.querySelectorAll('[data-ave-hidden="true"]');
    let originalOffer: Element | null = null;
    for (const hidden of hiddenOffers) {
      if (getOfferIdFromElement(hidden) === offerInfo.offerId) {
        originalOffer = hidden;
        break;
      }
    }
    if (originalOffer) {
      // Restore the original offer
      (originalOffer as HTMLElement).style.display = '';
      originalOffer.removeAttribute('data-ave-hidden');

      // Also restore the wrapper if it was hidden
      const wrapper = originalOffer.closest('[data-ave-wrapper-hidden="true"]');
      if (wrapper) {
        (wrapper as HTMLElement).style.display = '';
        wrapper.removeAttribute('data-ave-wrapper-hidden');
      }

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

export async function processMobileSearchPage(): Promise<void> {
  const hiddenContainer = createHiddenContainer();
  const offerElements = findOfferElements();

  // Always try to fetch initialData first - it has correct items for this page
  await fetchMobileCatalogIfNeeded();

  console.log(`${LOG_PREFIX} Processing ${offerElements.length} offers (catalog: ${mobileCatalogData.length} items)`);

  // First, check hidden container for clones - restore or update buttons
  if (hiddenContainer) {
    const clonedOffers = hiddenContainer.querySelectorAll('[data-ave-clone="true"]');
    for (const clonedOffer of clonedOffers) {
      const offerId = getOfferIdFromElement(clonedOffer);
      if (!offerId) continue;

      const userId = extractUserIdFromMobileData(mobileCatalogData, offerId);
      updateMobileOfferState(clonedOffer, { offerId, userId: userId || undefined });
    }
  }

  // Then process visible offers
  let processed = 0;
  for (const offerElement of offerElements) {
    const offerId = getOfferIdFromElement(offerElement);
    if (!offerId) {
      continue;
    }

    // Skip offers in the hidden container (handled above)
    if (hiddenContainer && hiddenContainer.contains(offerElement)) continue;

    // Skip offers that are already hidden (their clone is in the hidden container)
    if (offerElement.getAttribute('data-ave-hidden') === 'true') continue;

    const userId = extractUserIdFromMobileData(mobileCatalogData, offerId);

    // Check if this element already has buttons
    const hasButtons = offerElement.querySelector('.button-container');

    // Skip if already has buttons (unless blacklisted which needs re-processing)
    const userIsBlacklisted = userId ? isUserBlacklisted(userId) : false;
    const offerIsBlacklisted = offerId ? isOfferBlacklisted(offerId) : false;

    if (hasButtons && !userIsBlacklisted && !offerIsBlacklisted) continue;

    updateMobileOfferState(offerElement, { offerId, userId: userId || undefined });
    processed++;
  }
  if (processed > 0) {
    console.log(`${LOG_PREFIX} Processed ${processed} offers`);
  }

  // Update counter in hidden container header
  updateHiddenCounter();
}
