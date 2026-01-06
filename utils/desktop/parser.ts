/**
 * Parser utilities for desktop Avito pages
 */

import type { CatalogItem } from '../state';

const LOG_PREFIX = '[ave]';

export function decodeHtmlEntities(str: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

interface InitialData {
  data?: {
    catalog?: {
      items?: CatalogItem[];
      extraBlockItems?: CatalogItem[];
    };
    ssrData?: {
      initData?: {
        result?: {
          value?: {
            data?: {
              customLink?: string;
              profileUserHash?: string;
            };
          };
        };
      };
    };
  };
}

export function parseInitialData(initialDataContent: string): InitialData | null {
  try {
    const decodedContent = decodeURIComponent(initialDataContent);

    const startIndex = decodedContent.indexOf('window.__initialData__ = "') + 'window.__initialData__ = "'.length;
    const endIndex = decodedContent.indexOf('";\nwindow.__mfe__');

    const jsonString = decodedContent.substring(startIndex, endIndex);
    const initialData = JSON.parse(jsonString) as InitialData;
    return initialData;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error parsing __initialData__:`, error);
  }
  return null;
}

export function getCatalogDataFromInit(initialData: InitialData): CatalogItem[] | null {
  if (!initialData?.data?.catalog) {
    console.warn(`${LOG_PREFIX} No catalog data found in initialData`);
    return null;
  }
  const catalogItems = initialData.data.catalog.items || [];
  const extraItems = initialData.data.catalog.extraBlockItems || [];
  let allItems = catalogItems.concat(extraItems);
  allItems = allItems.filter((item) => 'categoryId' in item);
  return allItems;
}

export function getSellerId(initialData: InitialData): string | null {
  try {
    return initialData.data?.ssrData?.initData?.result?.value?.data?.customLink ||
           initialData.data?.ssrData?.initData?.result?.value?.data?.profileUserHash ||
           null;
  } catch {
    return null;
  }
}

// Extract seller ID directly from URL (more reliable than __initialData__)
export function getSellerIdFromUrl(): string | null {
  const pathname = window.location.pathname;
  const userMatch = pathname.match(/\/user\/([^\/]+)/);
  const brandMatch = pathname.match(/\/brands\/([^\/]+)/);

  if (userMatch) return userMatch[1].split('?')[0];
  if (brandMatch) return brandMatch[1].split('?')[0];
  return null;
}

export function getOfferId(offerElement: Element): string | null {
  return offerElement.getAttribute('data-item-id');
}

export function extractUserIdFromCatalogData(catalogData: CatalogItem[], offerId: string): string | null {
  const currentOfferData = catalogData.find((item) => item.id === Number(offerId));
  if (!currentOfferData) return null;

  try {
    const sellerUrl = currentOfferData?.iva?.UserInfoStep?.[0]?.payload?.profile?.link;
    return sellerUrl?.split('/')[2]?.split('?')[0] || null;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Error extracting userId:`, error);
    return null;
  }
}

// Extract userId directly from DOM element (fallback when catalog data is unavailable)
export function extractUserIdFromElement(offerElement: Element): string | null {
  const sellerLinkElement =
    offerElement.querySelector('a[href*="/user/"]') ||
    offerElement.querySelector('a[href*="/brands/"]');

  if (!sellerLinkElement) return null;

  const sellerHref = (sellerLinkElement as HTMLAnchorElement).href;
  const userMatch = sellerHref.match(/\/user\/([^\/]+)/);
  const brandMatch = sellerHref.match(/\/brands\/([^\/]+)/);

  if (userMatch) return userMatch[1].split('?')[0];
  if (brandMatch) return brandMatch[1].split('?')[0];
  return null;
}
