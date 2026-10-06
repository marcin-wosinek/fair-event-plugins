/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load connection settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to connection settings
 */
export function loadConnectionSettings() {
	console.log( '[Fair Payments Connector] Loading connection settings...' );

	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		console.log( '[Fair Payments Connector] Connection settings loaded' );
		return {
			connected: settings.fair_payment_mollie_connected || false,
			mode: settings.fair_payment_mode || 'test',
			organizationId: settings.fair_payment_organization_id || '',
			profileId: settings.fair_payment_mollie_profile_id || '',
			tokenExpires: settings.fair_payment_mollie_token_expires || null,
		};
	} );
}

/**
 * Save settings to WordPress REST API
 *
 * @param {Object} data Settings data to save
 * @return {Promise<Object>} Promise resolving to saved settings
 */
export function saveSettings( data ) {
	console.log(
		'[Fair Payments Connector] Saving settings:',
		Object.keys( data )
	);

	return apiFetch( {
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	} ).then( ( response ) => {
		console.log( '[Fair Payments Connector] Settings saved successfully' );
		return response;
	} );
}

/**
 * Save connector settings (mode, currency, bank-transfer threshold). The
 * generic /wp/v2/settings endpoint no longer accepts writes to these keys —
 * see Settings::MANUALLY_WRITTEN_SETTINGS. The server records a generated
 * description to the audit log; no reason is submitted from here.
 *
 * @param {Object} settings Setting key/value pairs to change.
 * @return {Promise<Object>} Promise resolving to the saved settings
 */
export function saveConnectorSettings( settings ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/settings',
		method: 'POST',
		data: { settings },
	} );
}

/**
 * Load a page of the settings/connection audit log, newest first.
 *
 * @param {Object} args          Pagination
 * @param {number} args.page     1-based page number
 * @param {number} args.perPage  Page size
 * @return {Promise<Object>} Promise resolving to { items, total, pages, page }
 */
export function loadAuditLog( { page = 1, perPage = 20 } = {} ) {
	return apiFetch( {
		path: `/fair-payments-connector/v1/audit-log?page=${ page }&per_page=${ perPage }`,
	} );
}

/**
 * Generate and retrieve a one-time OAuth state token from the server, along
 * with whether this site wants settlement access requested from Mollie.
 *
 * @return {Promise<Object>} Promise resolving to { state, requestSettlementAccess }
 */
export function fetchOAuthState() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/state',
		method: 'POST',
	} ).then( ( response ) => ( {
		state: response.state,
		requestSettlementAccess: response.request_settlement_access === true,
	} ) );
}

/**
 * Build the platform URL that starts the Mollie authorization.
 *
 * Settlement access is passed as a flag, never as a scope list — the
 * platform decides which permission that flag adds.
 *
 * @param {Object}  args                         Arguments
 * @param {string}  args.state                   One-time state from fetchOAuthState()
 * @param {boolean} args.requestSettlementAccess Whether to ask for settlement access
 * @return {string} Authorization URL
 */
export function buildAuthorizeUrl( { state, requestSettlementAccess } ) {
	const authorizeUrl = new URL(
		'https://fair-event-plugins.com/oauth/authorize'
	);
	authorizeUrl.searchParams.set(
		'site_id',
		btoa( window.location.hostname )
	);
	authorizeUrl.searchParams.set(
		'return_url',
		window.location.href.split( '?' )[ 0 ] +
			'?page=fair-payments-connector-settings'
	);
	authorizeUrl.searchParams.set( 'site_name', document.title );
	authorizeUrl.searchParams.set( 'site_url', window.location.origin );
	authorizeUrl.searchParams.set( 'state', state );
	if ( requestSettlementAccess ) {
		authorizeUrl.searchParams.set( 'settlement_access', '1' );
	}

	return authorizeUrl.toString();
}

/**
 * Load the connection status and the permissions Mollie granted.
 *
 * @return {Promise<Object>} Promise resolving to { connected, settlementAccess, settlementAccessRequested }
 */
export function loadOAuthStatus() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/status',
	} ).then( ( status ) => ( {
		connected: status.connected === true,
		settlementAccess: status.settlement_access === true,
		settlementAccessRequested: status.settlement_access_requested === true,
	} ) );
}

/**
 * Complete OAuth callback: validate state server-side and persist credentials.
 *
 * @param {Object} data Callback payload (state + token fields)
 * @return {Promise<Object>} Promise resolving to the API response
 */
export function saveOAuthCallback( data ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/callback',
		method: 'POST',
		data,
	} );
}

/**
 * Disconnect from Mollie: server clears the stored OAuth credentials and
 * records a generated audit description.
 *
 * @return {Promise<Object>} Promise resolving to the API response
 */
export function disconnectOAuth() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/disconnect',
		method: 'POST',
	} );
}

/**
 * Load the connected Mollie profile name and enabled payment methods.
 *
 * @return {Promise<Object>} Promise resolving to the connection overview
 */
export function loadConnectionOverview() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/connection/overview',
	} );
}

/**
 * Create a one-unit test payment and return its Mollie checkout details.
 *
 * @return {Promise<Object>} Promise resolving to { checkout_url, transaction_id, mode, currency }
 */
export function createTestPayment() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/test-payment',
		method: 'POST',
	} );
}

/**
 * Test Mollie connection and trigger token refresh if needed
 *
 * @return {Promise<Object>} Promise resolving to connection test result
 */
export function testConnection() {
	console.log( '[Fair Payments Connector] Testing connection...' );

	return apiFetch( {
		path: '/fair-payments-connector/v1/test-connection',
		method: 'POST',
	} ).then( ( response ) => {
		console.log(
			'[Fair Payments Connector] Connection test successful:',
			response
		);
		return response;
	} );
}

/**
 * Load every API token, newest first.
 *
 * @return {Promise<Object[]>} Promise resolving to the token list
 */
export function loadApiTokens() {
	return apiFetch( {
		path: '/fair-payments-connector/v1/admin/api-tokens',
	} );
}

/**
 * Create an API token.
 *
 * @param {Object}   data        Token details.
 * @param {string}   data.label  Name identifying who the token is for.
 * @param {string[]} data.scopes Scopes to grant.
 * @return {Promise<Object>} Promise resolving to the token, with its one-time plaintext `token`
 */
export function createApiToken( { label, scopes } ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/admin/api-tokens',
		method: 'POST',
		data: { label, scopes },
	} );
}

/**
 * Revoke an API token.
 *
 * @param {number} id Token ID.
 * @return {Promise<Object>} Promise resolving to the revoked token
 */
export function revokeApiToken( id ) {
	return apiFetch( {
		path: `/fair-payments-connector/v1/admin/api-tokens/${ id }`,
		method: 'DELETE',
	} );
}
