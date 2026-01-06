/**
 * API interceptor for mobile Avito
 * Intercepts fetch and XHR requests to capture catalog data
 */

import { appendMobileCatalogData, type MobileCatalogItem } from '../state';

const LOG_PREFIX = '[ave]';

// Callback to be set by initMobile() for triggering page processing
let onDataReceived: (() => void) | null = null;

export function setOnDataReceived(callback: () => void): void {
  onDataReceived = callback;
}

interface ApiResponse {
  result?: {
    items?: MobileCatalogItem[];
  };
}

function processApiResponse(url: string, responseText: string): void {
  // Check if this is the items API (matches /api/11/items, /api/9/items, etc.)
  if (url && /\/api\/\d+\/items/.test(url)) {
    try {
      const data = JSON.parse(responseText) as ApiResponse;
      if (data.result?.items && Array.isArray(data.result.items)) {
        // Filter out banners and other non-item types, only keep actual items
        const items = data.result.items.filter(item => item.type === 'item');
        if (items.length > 0) {
          console.log(`${LOG_PREFIX} Intercepted ${items.length} items from API`);
        }
        appendMobileCatalogData(items);

        // Trigger page processing if callback is set
        if (onDataReceived) {
          setTimeout(() => onDataReceived!(), 50);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }
}

declare global {
  interface Window {
    __aveFetchIntercepted?: boolean;
  }
}

export function installFetchInterceptor(): void {
  // Don't install twice
  if (window.__aveFetchIntercepted) {
    console.log(`${LOG_PREFIX} Fetch interceptor already installed`);
    return;
  }
  window.__aveFetchIntercepted = true;

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await originalFetch.call(this, input, init);
    const url = typeof input === 'string' ? input : (input as Request).url;

    if (url && /\/api\/\d+\/items/.test(url)) {
      const clone = response.clone();
      try {
        const text = await clone.text();
        processApiResponse(url, text);
      } catch {
        // Ignore
      }
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  interface ExtendedXHR extends XMLHttpRequest {
    _aveUrl?: string;
  }

  XMLHttpRequest.prototype.open = function(
    this: ExtendedXHR,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    this._aveUrl = url.toString();
    return originalXhrOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function(this: ExtendedXHR, body?: Document | XMLHttpRequestBodyInit | null): void {
    this.addEventListener('load', function(this: ExtendedXHR) {
      if (this._aveUrl && /\/api\/\d+\/items/.test(this._aveUrl)) {
        processApiResponse(this._aveUrl, this.responseText);
      }
    });
    return originalXhrSend.call(this, body);
  };

  console.log(`${LOG_PREFIX} Fetch/XHR interceptor installed`);
}
