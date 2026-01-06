/**
 * Mobile initialization for Avito
 */

import { installFetchInterceptor, setOnDataReceived } from './api-interceptor';
import { processMobileSearchPage } from './search';

const LOG_PREFIX = '[ave]';

export async function initMobile(): Promise<void> {
  console.log(`${LOG_PREFIX} Initializing mobile support`);

  // Ensure fetch interceptor is installed (may already be installed at script load)
  installFetchInterceptor();

  // Set callback for when API data is received
  setOnDataReceived(async () => {
    console.log(`${LOG_PREFIX} API data received, processing page`);
    await processMobileSearchPage();
  });

  // Detect page type
  const currentUrl = window.location.toString();
  const isSearchPage = currentUrl.includes('/items/search') ||
                       currentUrl.includes('?query=') ||
                       !currentUrl.includes('/user/');

  if (isSearchPage) {
    console.log(`${LOG_PREFIX} Mobile page detected: search`);
  } else {
    console.log(`${LOG_PREFIX} Mobile page detected: other`);
  }

  // Set up MutationObserver for mobile DOM
  // Mobile renders content dynamically via React, so we need to watch for changes
  let processTimeout: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            // Skip our own hidden container
            if (node.classList?.contains('hidden-container') ||
                (node as Element).closest?.('.hidden-container')) {
              continue;
            }

            // Check if this looks like item content
            if (node.querySelector?.('[data-marker="item"]') ||
                node.querySelector?.('[data-item-id]') ||
                node.querySelector?.('a[href*="_"]') ||
                node.getAttribute?.('data-marker') === 'item' ||
                node.getAttribute?.('data-item-id')) {
              shouldProcess = true;
              break;
            }
          }
        }
      }
      if (shouldProcess) break;
    }

    if (shouldProcess) {
      // Debounce processing to avoid too many calls
      if (processTimeout) clearTimeout(processTimeout);
      processTimeout = setTimeout(async () => {
        console.log(`${LOG_PREFIX} DOM changes detected, processing mobile offers`);
        await processMobileSearchPage();
      }, 100);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // Also process after a short delay to catch initial render
  setTimeout(async () => {
    console.log(`${LOG_PREFIX} Initial mobile page processing`);
    await processMobileSearchPage();
  }, 500);

  // Process again after content likely loaded
  setTimeout(async () => {
    await processMobileSearchPage();
  }, 1500);
}

// Export for early installation
export { installFetchInterceptor };
