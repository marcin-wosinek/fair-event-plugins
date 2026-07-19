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
	console.log('[Fair Payments Connector] Loading connection settings...');

	return apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
		console.log('[Fair Payments Connector] Connection settings loaded');
		return {
			connected: settings.fair_payment_mollie_connected || false,
			mode: settings.fair_payment_mode || 'test',
			organizationId: settings.fair_payment_organization_id || '',
			profileId: settings.fair_payment_mollie_profile_id || '',
			tokenExpires: settings.fair_payment_mollie_token_expires || null,
		};
	});
}

/**
 * Save settings to WordPress REST API
 *
 * @param {Object} data Settings data to save
 * @return {Promise<Object>} Promise resolving to saved settings
 */
export function saveSettings(data) {
	console.log(
		'[Fair Payments Connector] Saving settings:',
		Object.keys(data)
	);

	return apiFetch({
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	}).then((response) => {
		console.log('[Fair Payments Connector] Settings saved successfully');
		return response;
	});
}

/**
 * Generate and retrieve a one-time OAuth state token from the server.
 *
 * @return {Promise<string>} Promise resolving to the state string
 */
export function fetchOAuthState() {
	return apiFetch({
		path: '/fair-payments-connector/v1/oauth/state',
		method: 'POST',
	}).then((response) => response.state);
}

/**
 * Complete OAuth callback: validate state server-side and persist credentials.
 *
 * @param {Object} data Callback payload (state + token fields)
 * @return {Promise<Object>} Promise resolving to the API response
 */
export function saveOAuthCallback(data) {
	return apiFetch({
		path: '/fair-payments-connector/v1/oauth/callback',
		method: 'POST',
		data,
	});
}

/**
 * Load the connected Mollie profile name and enabled payment methods.
 *
 * @return {Promise<Object>} Promise resolving to the connection overview
 */
export function loadConnectionOverview() {
	return apiFetch({
		path: '/fair-payments-connector/v1/connection/overview',
	});
}

/**
 * Test Mollie connection and trigger token refresh if needed
 *
 * @return {Promise<Object>} Promise resolving to connection test result
 */
export function testConnection() {
	console.log('[Fair Payments Connector] Testing connection...');

	return apiFetch({
		path: '/fair-payments-connector/v1/test-connection',
		method: 'POST',
	}).then((response) => {
		console.log(
			'[Fair Payments Connector] Connection test successful:',
			response
		);
		return response;
	});
}
