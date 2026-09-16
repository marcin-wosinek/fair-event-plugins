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
 * Save connector settings that require an audit reason (mode, currency,
 * bank-transfer threshold). The generic /wp/v2/settings endpoint no longer
 * accepts writes to these keys — see Settings::MANUALLY_WRITTEN_SETTINGS.
 *
 * @param {Object} settings Setting key/value pairs to change.
 * @param {string} reason   Non-empty reason, recorded to the audit log.
 * @return {Promise<Object>} Promise resolving to the saved settings
 */
export function saveConnectorSettings( settings, reason ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/settings',
		method: 'POST',
		data: { settings, reason },
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
 * Generate and retrieve a one-time OAuth state token from the server, bound
 * to the reason for this authorization attempt.
 *
 * @param {string} reason Non-empty reason, recorded to the audit log once the
 *                        connection succeeds.
 * @return {Promise<string>} Promise resolving to the state string
 */
export function fetchOAuthState( reason ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/state',
		method: 'POST',
		data: { reason },
	} ).then( ( response ) => response.state );
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
 * Disconnect from Mollie: server clears the stored OAuth credentials.
 *
 * @param {string} reason Non-empty reason, recorded to the audit log.
 * @return {Promise<Object>} Promise resolving to the API response
 */
export function disconnectOAuth( reason ) {
	return apiFetch( {
		path: '/fair-payments-connector/v1/oauth/disconnect',
		method: 'POST',
		data: { reason },
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
