/**
 * Supabase client for CleanAvito
 * Handles all communication with Supabase backend for shared blacklists
 */

// Supabase configuration
const SUPABASE_URL = 'https://yhmdtsqyzftxvgkvdhrh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HvvfpRhcX1NHvm0dvcvGSg_YLkFlG6g';

export interface BlacklistEntry {
  id: string;
  addedAt: number;
}

export interface SupabaseList {
  id: string;
  name: string;
  description: string;
  users: (string | BlacklistEntry)[];
  offers: (string | BlacklistEntry)[];
  created_at: string;
  updated_at: string;
}

/**
 * SHA-256 hash function for edit code hashing
 */
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Generate a random edit code (UUID v4)
 */
function generateEditCode(): string {
  return crypto.randomUUID();
}

/**
 * Make a fetch request to Supabase REST API
 */
async function supabaseFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const url = `${SUPABASE_URL}/rest/v1${endpoint}`;

  const headers: HeadersInit = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}

/**
 * Make a request to Supabase stored function
 */
async function callFunction<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Function ${functionName} failed: ${error}`);
  }

  return response.json();
}

/**
 * Create a new blacklist on Supabase
 */
export async function createList(params: {
  name: string;
  description?: string;
  users?: string[];
  offers?: string[];
}): Promise<{ id: string; editCode: string }> {
  const editCode = generateEditCode();
  const editCodeHash = await sha256(editCode);

  const data = {
    name: params.name,
    description: params.description || '',
    edit_code_hash: editCodeHash,
    users: JSON.stringify(params.users || []),
    offers: JSON.stringify(params.offers || []),
    metadata: JSON.stringify({
      created_by: 'clean-avito',
      version: '1.0',
    }),
  };

  const response = await supabaseFetch('/blacklists', {
    method: 'POST',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create list: ${error}`);
  }

  const result = (await response.json()) as Array<{ id: string }>;
  const listId = result[0].id;

  return {
    id: listId,
    editCode: editCode,
  };
}

/**
 * Fetch a blacklist from Supabase (read-only, no auth needed)
 */
export async function fetchList(listId: string): Promise<SupabaseList> {
  const response = await supabaseFetch(`/blacklists?id=eq.${listId}&select=*`);

  if (!response.ok) {
    throw new Error(`Failed to fetch list: ${response.statusText}`);
  }

  const data = (await response.json()) as Array<{
    id: string;
    name: string;
    description: string;
    users: string;
    offers: string;
    created_at: string;
    updated_at: string;
  }>;

  if (data.length === 0) {
    throw new Error('List not found');
  }

  const list = data[0];

  return {
    id: list.id,
    name: list.name,
    description: list.description,
    users: JSON.parse(list.users),
    offers: JSON.parse(list.offers),
    created_at: list.created_at,
    updated_at: list.updated_at,
  };
}

/**
 * Fetch multiple blacklists in batch
 */
export async function fetchLists(listIds: string[]): Promise<SupabaseList[]> {
  if (listIds.length === 0) {
    return [];
  }

  const orQuery = listIds.map((id) => `id.eq.${id}`).join(',');
  const response = await supabaseFetch(`/blacklists?or=(${orQuery})&select=*`);

  if (!response.ok) {
    throw new Error(`Failed to fetch lists: ${response.statusText}`);
  }

  const data = (await response.json()) as Array<{
    id: string;
    name: string;
    description: string;
    users: string;
    offers: string;
    created_at: string;
    updated_at: string;
  }>;

  return data.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    users: JSON.parse(list.users),
    offers: JSON.parse(list.offers),
    created_at: list.created_at,
    updated_at: list.updated_at,
  }));
}

/**
 * Update a blacklist (requires edit code)
 */
export async function updateList(
  listId: string,
  editCode: string,
  params: {
    users: (string | BlacklistEntry)[];
    offers: (string | BlacklistEntry)[];
    name?: string | null;
    description?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const editCodeHash = await sha256(editCode);

  const result = await callFunction<{ success: boolean; error?: string }>('update_blacklist', {
    list_id: listId,
    edit_code_hash_input: editCodeHash,
    new_users: JSON.stringify(params.users),
    new_offers: JSON.stringify(params.offers),
    new_name: params.name,
    new_description: params.description,
  });

  return result;
}

/**
 * Delete a blacklist (requires edit code)
 */
export async function deleteList(listId: string, editCode: string): Promise<{ success: boolean; error?: string }> {
  const editCodeHash = await sha256(editCode);

  const result = await callFunction<{ success: boolean; error?: string }>('delete_blacklist', {
    list_id: listId,
    edit_code_hash_input: editCodeHash,
  });

  return result;
}

export { generateEditCode, sha256 };
