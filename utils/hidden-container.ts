/**
 * Hidden container for blocked offers
 */

// Desktop and mobile selectors for the offers container
const OFFERS_ROOT_SELECTORS = [
  '[elementtiming="bx.catalog.container"]', // Desktop
  '[class*="items-items"]', // Desktop fallback
  '[data-marker="catalog-serp"]', // Mobile
  '[class*="serp-"]', // Mobile fallback
  'main', // Generic fallback
  'body', // Last resort
];

const isMobile = typeof window !== 'undefined' && window.location.hostname === 'm.avito.ru';

export function createHiddenContainer(): HTMLDivElement | null {
  // Return existing container if already created
  const existingContainerEl = document.querySelector('.hidden-container') as HTMLDivElement | null;
  if (existingContainerEl) return existingContainerEl;

  // For mobile, only create container if we're on a search page
  // (detected by DOM elements since mobile is a SPA)
  if (isMobile) {
    const isSearchPage =
      document.querySelector('[data-marker="items/list"]') ||
      document.querySelectorAll('[data-marker="item"]').length > 0;
    if (!isSearchPage) {
      return null;
    }
  }

  // Find a suitable parent element
  let offersRoot: Element | null = null;
  for (const selector of OFFERS_ROOT_SELECTORS) {
    offersRoot = document.querySelector(selector);
    if (offersRoot) break;
  }

  if (!offersRoot) return null;

  const hr = document.createElement('hr');
  hr.classList.add('custom-hr');

  const detailsElement = document.createElement('details');

  const summaryElement = document.createElement('summary');
  summaryElement.classList.add('custom-summary');

  const summaryText = document.createElement('span');
  summaryText.textContent = 'Скрытые объявления ';

  const counterSpan = document.createElement('span');
  counterSpan.classList.add('hidden-counter');
  counterSpan.textContent = '(0)';

  summaryElement.appendChild(summaryText);
  summaryElement.appendChild(counterSpan);

  const contentElement = document.createElement('div');
  contentElement.classList.add('hidden-container');

  detailsElement.appendChild(summaryElement);
  detailsElement.appendChild(contentElement);

  if (isMobile) {
    // Mobile: insert at top of items list
    const itemsList = document.querySelector('[data-marker="items/list"]');
    if (itemsList) {
      // Make elements take full width in flex container
      detailsElement.style.width = '100%';
      hr.style.width = '100%';
      // Insert details first, then hr after it
      itemsList.insertBefore(detailsElement, itemsList.firstChild);
      itemsList.insertBefore(hr, detailsElement.nextSibling);
    } else {
      // Fallback: insert at top of offersRoot
      offersRoot.insertBefore(detailsElement, offersRoot.firstChild);
      offersRoot.insertBefore(hr, detailsElement.nextSibling);
    }
  } else {
    // Desktop: append at bottom
    offersRoot.appendChild(hr);
    offersRoot.appendChild(detailsElement);
  }

  return contentElement;
}

export function updateHiddenCounter(): void {
  const container = document.querySelector('.hidden-container');
  const counter = document.querySelector('.hidden-counter');
  if (container && counter) {
    // Count only direct children with data-ave-clone attribute
    const count = Array.from(container.children).filter(
      (child) => child.getAttribute('data-ave-clone') === 'true',
    ).length;
    counter.textContent = `(${count})`;
  }
}
