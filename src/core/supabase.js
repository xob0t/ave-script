/**
 * Supabase client for ave-script
 * Handles all communication with Supabase backend for shared blacklists
 */

// Supabase configuration
const SUPABASE_URL = 'https://yhmdtsqyzftxvgkvdhrh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HvvfpRhcX1NHvm0dvcvGSg_YLkFlG6g';

/**
 * SHA-256 hash function for edit code hashing
 * @param {string} message - The message to hash
 * @returns {Promise<string>} Hex string of the hash
 */
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

/**
 * Generate a random edit code (UUID v4)
 * @returns {string} UUID string
 */
function generateEditCode() {
    return crypto.randomUUID();
}

/**
 * Make a fetch request to Supabase REST API
 * @param {string} endpoint - API endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function supabaseFetch(endpoint, options = {}) {
    const url = `${SUPABASE_URL}/rest/v1${endpoint}`;

    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...options.headers
    };

    const response = await fetch(url, {
        ...options,
        headers
    });

    return response;
}

/**
 * Make a request to Supabase stored function
 * @param {string} functionName - Function name
 * @param {object} params - Function parameters
 * @returns {Promise<any>}
 */
async function callFunction(functionName, params) {
    const url = `${SUPABASE_URL}/rest/v1/rpc/${functionName}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(params)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Function ${functionName} failed: ${error}`);
    }

    return response.json();
}

/**
 * Create a new blacklist on Supabase
 * @param {object} params
 * @param {string} params.name - List name
 * @param {string} params.description - List description
 * @param {Array<string>} params.users - Array of user IDs
 * @param {Array<string>} params.offers - Array of offer IDs
 * @returns {Promise<{id: string, editCode: string}>}
 */
async function createList({ name, description = '', users = [], offers = [] }) {
    const editCode = generateEditCode();
    const editCodeHash = await sha256(editCode);

    const data = {
        name,
        description,
        edit_code_hash: editCodeHash,
        users: JSON.stringify(users),
        offers: JSON.stringify(offers),
        metadata: JSON.stringify({
            created_by: 'ave-script',
            version: '1.0'
        })
    };

    const response = await supabaseFetch('/blacklists', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create list: ${error}`);
    }

    const result = await response.json();
    const listId = result[0].id;

    return {
        id: listId,
        editCode: editCode
    };
}

/**
 * Fetch a blacklist from Supabase (read-only, no auth needed)
 * @param {string} listId - List UUID
 * @returns {Promise<object>} List data
 */
async function fetchList(listId) {
    const response = await supabaseFetch(`/blacklists?id=eq.${listId}&select=*`);

    if (!response.ok) {
        throw new Error(`Failed to fetch list: ${response.statusText}`);
    }

    const data = await response.json();

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
        updated_at: list.updated_at
    };
}

/**
 * Fetch multiple blacklists in batch
 * @param {Array<string>} listIds - Array of list UUIDs
 * @returns {Promise<Array<object>>} Array of list data
 */
async function fetchLists(listIds) {
    if (listIds.length === 0) {
        return [];
    }

    // Build OR query: id=eq.uuid1,id=eq.uuid2,...
    const orQuery = listIds.map(id => `id.eq.${id}`).join(',');
    const response = await supabaseFetch(`/blacklists?or=(${orQuery})&select=*`);

    if (!response.ok) {
        throw new Error(`Failed to fetch lists: ${response.statusText}`);
    }

    const data = await response.json();

    return data.map(list => ({
        id: list.id,
        name: list.name,
        description: list.description,
        users: JSON.parse(list.users),
        offers: JSON.parse(list.offers),
        created_at: list.created_at,
        updated_at: list.updated_at
    }));
}

/**
 * Update a blacklist (requires edit code)
 * @param {string} listId - List UUID
 * @param {string} editCode - Edit code (will be hashed)
 * @param {object} params
 * @param {Array<string>} params.users - Array of user IDs
 * @param {Array<string>} params.offers - Array of offer IDs
 * @param {string} [params.name] - Optional new name
 * @param {string} [params.description] - Optional new description
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function updateList(listId, editCode, { users, offers, name = null, description = null }) {
    const editCodeHash = await sha256(editCode);

    const result = await callFunction('update_blacklist', {
        list_id: listId,
        edit_code_hash_input: editCodeHash,
        new_users: JSON.stringify(users),
        new_offers: JSON.stringify(offers),
        new_name: name,
        new_description: description
    });

    return result;
}

/**
 * Delete a blacklist (requires edit code)
 * @param {string} listId - List UUID
 * @param {string} editCode - Edit code (will be hashed)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteList(listId, editCode) {
    const editCodeHash = await sha256(editCode);

    const result = await callFunction('delete_blacklist', {
        list_id: listId,
        edit_code_hash_input: editCodeHash
    });

    return result;
}

// Export all functions
export {
    createList,
    fetchList,
    fetchLists,
    updateList,
    deleteList,
    generateEditCode,
    sha256
};
