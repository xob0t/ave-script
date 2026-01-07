/**
 * Desktop initialization for Avito
 */

import { type CatalogItem, setCatalogData } from '../state';
import { initPagination } from './pagination';
import { decodeHtmlEntities, getSellerId, getSellerIdFromUrl, parseInitialData } from './parser';
import { processSearchPage } from './search';
import { processSellerPage } from './seller';

const LOG_PREFIX = '[ave]';
const OFFERS_ROOT_SELECTOR_VALUE = 'bx.catalog.container';

// Try to extract catalog data from a parsed JSON object
function extractCatalogData(initData: Record<string, unknown>): CatalogItem[] | null {
  // Helper to extract items + extraBlockItems from a catalog object
  function extractFromCatalog(
    catalog: { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] } | null,
  ): CatalogItem[] | null {
    if (!catalog) return null;
    const catalogItems = catalog.items || [];
    const extraItems = catalog.extraBlockItems || [];
    let allItems = catalogItems.concat(extraItems);
    // Filter to only items with expected properties
    allItems = allItems.filter((item) => item.id || item.categoryId);
    if (allItems.length > 0) {
      console.log(`${LOG_PREFIX} Extracted ${catalogItems.length} items + ${extraItems.length} extraBlockItems`);
      return allItems;
    }
    return null;
  }

  // Try path: data.catalog (original extension format)
  const data = initData.data as { catalog?: { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] } } | undefined;
  if (data?.catalog) {
    const result = extractFromCatalog(data.catalog);
    if (result) return result;
  }

  // Try path: state.catalog (abCentral format)
  const state = initData.state as { catalog?: { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] } } | undefined;
  if (state?.catalog) {
    const result = extractFromCatalog(state.catalog);
    if (result) return result;
  }

  // Try path: catalog (direct)
  const catalog = initData.catalog as { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] } | undefined;
  if (catalog) {
    const result = extractFromCatalog(catalog);
    if (result) return result;
  }

  // Search recursively for catalog object with items
  function findCatalog(obj: unknown, depth = 0): { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] } | null {
    if (!obj || typeof obj !== 'object' || depth > 5) return null;

    const record = obj as Record<string, unknown>;

    // Check if this object has 'items' array with expected structure
    if (Array.isArray(record.items) && record.items.length > 0) {
      const firstItem = record.items[0] as CatalogItem;
      if (firstItem && (firstItem.id || firstItem.categoryId || firstItem.iva)) {
        return record as { items?: CatalogItem[]; extraBlockItems?: CatalogItem[] };
      }
    }

    // Recurse into object properties
    for (const key of Object.keys(record)) {
      if (typeof record[key] === 'object') {
        const result = findCatalog(record[key], depth + 1);
        if (result) return result;
      }
    }
    return null;
  }

  const foundCatalog = findCatalog(initData);
  if (foundCatalog) {
    const result = extractFromCatalog(foundCatalog);
    if (result) return result;
  }

  return null;
}

// Try to find catalog data from existing scripts already in DOM (sync, no fetch)
function findExistingCatalogData(): CatalogItem[] | null {
  // Try abCentral JSON script in DOM
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent?.includes('abCentral') && script.textContent.trim().startsWith('{')) {
      try {
        const decodedJson = decodeHtmlEntities(script.textContent);
        const initData = JSON.parse(decodedJson) as Record<string, unknown>;
        const catalogDataResult = extractCatalogData(initData);
        if (catalogDataResult && catalogDataResult.length > 0) {
          console.log(`${LOG_PREFIX} Found ${catalogDataResult.length} items from abCentral script`);
          return catalogDataResult;
        }
      } catch {
        // Continue searching
      }
    }
  }

  // Try MFE state script in DOM
  const mfeStateScript = document.querySelector('script[type="mime/invalid"][data-mfe-state="true"]');
  if (mfeStateScript?.textContent) {
    try {
      const decodedJson = decodeHtmlEntities(mfeStateScript.textContent);
      const initData = JSON.parse(decodedJson) as Record<string, unknown>;
      const catalogDataResult = extractCatalogData(initData);
      if (catalogDataResult && catalogDataResult.length > 0) {
        console.log(`${LOG_PREFIX} Found ${catalogDataResult.length} items from MFE state script`);
        return catalogDataResult;
      }
    } catch {
      // Continue
    }
  }

  // Fallback: Extract catalog data directly from DOM elements
  const domCatalogData = getCatalogDataFromDOM();
  if (domCatalogData && domCatalogData.length > 0) {
    console.log(`${LOG_PREFIX} Extracted ${domCatalogData.length} items from DOM elements`);
    return domCatalogData;
  }

  return null;
}

// Final fallback: fetch page source and extract catalog data
async function fetchCatalogDataFallback(): Promise<CatalogItem[] | null> {
  console.log(`${LOG_PREFIX} Fallback: fetching page source...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(window.location.href, { signal: controller.signal });
    clearTimeout(timeoutId);

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Look for abCentral script in fetched HTML
    const fetchedScripts = doc.querySelectorAll('script');
    for (const script of fetchedScripts) {
      if (script.textContent?.includes('abCentral') && script.textContent.trim().startsWith('{')) {
        try {
          const decodedJson = decodeHtmlEntities(script.textContent);
          const initData = JSON.parse(decodedJson) as Record<string, unknown>;
          const catalogDataResult = extractCatalogData(initData);
          if (catalogDataResult && catalogDataResult.length > 0) {
            console.log(`${LOG_PREFIX} Fallback: found ${catalogDataResult.length} items from fetched HTML`);
            return catalogDataResult;
          }
        } catch {
          // Continue
        }
      }
    }

    // Try MFE state script in fetched HTML
    const mfeScript = doc.querySelector('script[type="mime/invalid"][data-mfe-state="true"]');
    if (mfeScript?.textContent) {
      try {
        const decodedJson = decodeHtmlEntities(mfeScript.textContent);
        const initData = JSON.parse(decodedJson) as Record<string, unknown>;
        const catalogDataResult = extractCatalogData(initData);
        if (catalogDataResult && catalogDataResult.length > 0) {
          console.log(`${LOG_PREFIX} Fallback: found ${catalogDataResult.length} items from fetched MFE state`);
          return catalogDataResult;
        }
      } catch {
        // Continue
      }
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Fallback fetch failed:`, error);
  }

  return null;
}

// Extract catalog data directly from DOM elements (fallback method)
function getCatalogDataFromDOM(): CatalogItem[] {
  const catalogDataResult: CatalogItem[] = [];
  let withSeller = 0;
  let withoutSeller = 0;

  // Method 1: Extract from elements with data-item-id
  const offerElements = document.querySelectorAll('[data-item-id]');
  console.log(`${LOG_PREFIX} DOM: Found ${offerElements.length} elements with data-item-id`);

  offerElements.forEach((element) => {
    const offerId = element.getAttribute('data-item-id');
    if (offerId) {
      // Find seller link (supports both /user/ and /brands/)
      const sellerLinkElement =
        element.querySelector('a[href*="/user/"]') || element.querySelector('a[href*="/brands/"]');

      let userId: string | null = null;
      if (sellerLinkElement) {
        const sellerHref = (sellerLinkElement as HTMLAnchorElement).href;
        const userMatch = sellerHref.match(/\/user\/([^/]+)/);
        const brandMatch = sellerHref.match(/\/brands\/([^/]+)/);

        if (userMatch) {
          userId = userMatch[1].split('?')[0];
        } else if (brandMatch) {
          userId = brandMatch[1].split('?')[0];
        }
      }

      if (userId) {
        withSeller++;
      } else {
        withoutSeller++;
      }

      catalogDataResult.push({
        id: parseInt(offerId, 10),
        userId: userId || undefined,
        // Create minimal structure for compatibility with extractUserIdFromCatalogData
        iva: {
          UserInfoStep: [
            {
              payload: {
                profile: {
                  link: (sellerLinkElement as HTMLAnchorElement)?.href || '',
                },
              },
            },
          ],
        },
      });
    }
  });

  console.log(`${LOG_PREFIX} DOM extraction: ${withSeller} with seller, ${withoutSeller} without seller`);
  return catalogDataResult;
}

// Try to find initialData for seller pages from existing scripts
function findExistingInitialData(): ReturnType<typeof parseInitialData> {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent?.includes('__initialData__')) {
      return parseInitialData(script.textContent);
    }
  }
  return null;
}

export async function initDesktop(): Promise<void> {
  const currentUrl = window.location.toString();
  const userPageStrings = ['www.avito.ru/user/', 'sellerId', 'brands'];
  const isUserPage = userPageStrings.some((str) => currentUrl.includes(str));

  if (isUserPage) {
    console.log(`${LOG_PREFIX} page detected: seller`);
  } else {
    console.log(`${LOG_PREFIX} page detected: search`);
    // Initialize auto-pagination for search pages
    initPagination();
  }

  let initialData: ReturnType<typeof parseInitialData> | null = null;

  // Check for existing data on page load
  if (isUserPage) {
    // Primary method: extract seller ID from URL
    let userId = getSellerIdFromUrl();
    if (userId) {
      console.log(`${LOG_PREFIX} Seller userId from URL: ${userId}`);
      // Delay processing to wait for sidebar DOM to be ready
      setTimeout(() => processSellerPage(userId!), 500);
    } else {
      // Fallback: try to get from initialData
      initialData = findExistingInitialData();
      if (initialData) {
        console.log(`${LOG_PREFIX} Found existing initialData on page load`);
        userId = getSellerId(initialData);
        console.log(`${LOG_PREFIX} Seller userId from initialData: ${userId}`);
        if (userId) {
          setTimeout(() => processSellerPage(userId!), 500);
        }
      } else {
        console.log(`${LOG_PREFIX} No userId found, waiting for MutationObserver`);
      }
    }
  } else {
    // Try to find catalog data already in DOM
    const existingCatalogData = findExistingCatalogData();
    let catalogFound = false;
    if (existingCatalogData && existingCatalogData.length > 0) {
      setCatalogData(existingCatalogData);
      catalogFound = true;
    }

    // Check if there are already offers on the page
    const existingOffers = document.querySelectorAll('[data-marker="item"]');
    if (existingOffers.length > 0) {
      console.log(`${LOG_PREFIX} Found ${existingOffers.length} existing offers on page`);
      processSearchPage();
    }

    // Schedule fallback fetch if no catalog data found yet
    // This runs after MutationObserver has had a chance to catch scripts
    if (!catalogFound) {
      setTimeout(async () => {
        // Check again if catalog data was found by MutationObserver
        const currentData = findExistingCatalogData();
        if (!currentData || currentData.length === 0) {
          const fallbackData = await fetchCatalogDataFallback();
          if (fallbackData && fallbackData.length > 0) {
            setCatalogData(fallbackData);
            processSearchPage();
          }
        }
      }, 2000); // 2 second delay before fallback
    }
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(async (node) => {
          if (isUserPage) {
            // Seller page
            if (node instanceof Element) {
              // Check if sidebar container appeared
              const isSidebar =
                node.matches?.('[class^="ExtendedProfileStickyContainer-"]') ||
                node.querySelector?.('[class^="ExtendedProfileStickyContainer-"]');
              // Check for profile badge appearing
              const hasBadge =
                node.matches?.('[class^="ProfileBadge-root-"]') ||
                node.querySelector?.('[class^="ProfileBadge-root-"]');
              // Check for subscribe/contact buttons
              const hasButtons =
                node.querySelector?.('[class*="SubscribeInfo-module-subscribe"]') ||
                node.querySelector?.('[class*="ContactBar-module-controls"]');

              if (isSidebar || hasBadge || hasButtons) {
                console.log(`${LOG_PREFIX} seller page sidebar/badge/buttons detected`);
                // Use URL as primary source
                const userId = getSellerIdFromUrl();
                if (userId) {
                  processSellerPage(userId);
                }
              }
            }
            if (
              (node as Element)?.nodeName === 'SCRIPT' &&
              (node as Element)?.textContent?.includes('__initialData__')
            ) {
              const initialDataContent = (node as Element).textContent!;
              initialData = parseInitialData(initialDataContent);
              console.log(`${LOG_PREFIX} initialData found`);
              // Use URL as primary source, initialData as fallback
              let userId = getSellerIdFromUrl();
              if (!userId && initialData) {
                userId = getSellerId(initialData);
              }
              console.log(`${LOG_PREFIX} Seller userId: ${userId}`);
              if (userId) {
                processSellerPage(userId);
              }
            }
          } else {
            // Search page
            if (node instanceof Element) {
              // Skip mutations inside the hidden container to prevent infinite loops
              const hiddenContainer = document.querySelector('.hidden-container');
              if (
                hiddenContainer &&
                (hiddenContainer.contains(node) || (node as Element).closest?.('.hidden-container'))
              ) {
                return; // Skip - this is our own DOM manipulation
              }

              // Skip if this is the hidden container itself or its parent elements (details, summary, hr)
              if (
                node.classList?.contains('hidden-container') ||
                node.classList?.contains('custom-hr') ||
                node.classList?.contains('custom-summary') ||
                (node.tagName === 'DETAILS' && node.querySelector('.hidden-container'))
              ) {
                return; // Skip - this is our own DOM manipulation
              }

              // Check if this node or its children contain offer items
              if (
                node.getAttribute('elementtiming') === OFFERS_ROOT_SELECTOR_VALUE ||
                node.classList?.toString().includes('styles-singlePageWrapper') ||
                node.querySelector?.('[data-marker="item"]') ||
                node.getAttribute?.('data-marker') === 'item'
              ) {
                console.log(`${LOG_PREFIX} Offers detected in DOM`);
                processSearchPage();
              }
            }
            // Watch for MFE state script or abCentral script being added
            if (node instanceof HTMLScriptElement) {
              const isMfeStateScript = node.type === 'mime/invalid' && node.dataset.mfeState === 'true';
              const isAbCentralScript =
                node.textContent?.includes('abCentral') && node.textContent?.trim().startsWith('{');

              if (isMfeStateScript || isAbCentralScript) {
                try {
                  const decodedJson = decodeHtmlEntities(node.textContent || '');
                  const initData = JSON.parse(decodedJson) as Record<string, unknown>;
                  const catalogDataResult = extractCatalogData(initData);
                  if (catalogDataResult && catalogDataResult.length > 0) {
                    setCatalogData(catalogDataResult);
                    console.log(`${LOG_PREFIX} catalogData received (${catalogDataResult.length} items)`);
                    processSearchPage();
                  }
                } catch (error) {
                  console.error(`${LOG_PREFIX} Error processing catalog data:`, error);
                }
              }
            }
          }
        });
      }
    });
  });

  const config = { attributes: false, childList: true, subtree: true };
  observer.observe(document, config);
}
