/**
 * Browser-held access tokens for the post-checkout status read.
 *
 * The status endpoint gates anonymous reads with a per-transaction access
 * token. It used to travel in the return URL, which leaks through Referer
 * headers, history and access logs, so the token now waits in session storage
 * (per tab, cleared when the tab closes) and is sent in a request header.
 *
 * @package FairPaymentsConnector
 */

export const TOKEN_HEADER = 'X-Fair-Payment-Token';

const KEY_PREFIX = 'fairPaymentsConnector.accessToken.';

function storage() {
	try {
		return window.sessionStorage;
	} catch ( error ) {
		// Accessing the property throws when site data is blocked.
		return null;
	}
}

/**
 * Whether session storage can hold a credential right now.
 *
 * @return {boolean} True when a test write and removal succeed.
 */
export function isCredentialStorageAvailable() {
	const store = storage();
	if ( ! store ) {
		return false;
	}
	try {
		const probe = KEY_PREFIX + 'probe';
		store.setItem( probe, '1' );
		store.removeItem( probe );
		return true;
	} catch ( error ) {
		return false;
	}
}

/**
 * Keep a transaction's access token for the return page.
 *
 * @param {string|number} transactionId Transaction id.
 * @param {string}        token         Access token.
 * @return {boolean} True when the token was stored.
 */
export function saveCredential( transactionId, token ) {
	const store = storage();
	if ( ! store || ! transactionId || ! token ) {
		return false;
	}
	try {
		store.setItem( KEY_PREFIX + transactionId, token );
		return true;
	} catch ( error ) {
		return false;
	}
}

/**
 * Read a transaction's stored access token.
 *
 * @param {string|number} transactionId Transaction id.
 * @return {string} The token, or '' when none is available.
 */
export function readCredential( transactionId ) {
	const store = storage();
	if ( ! store || ! transactionId ) {
		return '';
	}
	try {
		return store.getItem( KEY_PREFIX + transactionId ) || '';
	} catch ( error ) {
		return '';
	}
}

/**
 * Forget a transaction's stored access token.
 *
 * @param {string|number} transactionId Transaction id.
 */
export function removeCredential( transactionId ) {
	const store = storage();
	if ( ! store || ! transactionId ) {
		return;
	}
	try {
		store.removeItem( KEY_PREFIX + transactionId );
	} catch ( error ) {
		// Nothing to clean up when storage is unavailable.
	}
}

/**
 * Request headers that authenticate a status read for a transaction.
 *
 * @param {string|number} transactionId Transaction id.
 * @return {Object|undefined} Headers, or undefined when no token is stored.
 */
export function credentialHeaders( transactionId ) {
	const token = readCredential( transactionId );
	return token ? { [ TOKEN_HEADER ]: token } : undefined;
}
