/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load Instagram connection settings from WordPress REST API
 *
 * `connected` is the stored connection flag. `credentialStatus` says whether
 * the stored access token can be used: 'available', 'encryption_unavailable'
 * (temporarily, until the server's encryption support is restored) or
 * 'unrecoverable' (reconnect needed), explained by `credentialMessage`.
 * `reconnectRequired` marks a connection made before Meta's Unified Login.
 * The access token itself is never returned.
 *
 * @return {Promise<Object>} Promise resolving to connection settings
 */
export function loadInstagramSettings() {
	return Promise.all( [
		apiFetch( { path: '/wp/v2/settings' } ),
		apiFetch( { path: '/fair-audience/v1/instagram/credentials' } ),
	] ).then( ( [ settings, credentials ] ) => {
		return {
			connected: settings.fair_audience_instagram_connected || false,
			credentialStatus: credentials.credential_status || 'available',
			credentialMessage: credentials.message || '',
			// Stored before Meta's Unified Login: connect again in Fair Events.
			reconnectRequired: credentials.reconnect_required === true,
			username: settings.fair_audience_instagram_username || '',
			userId: settings.fair_audience_instagram_user_id || '',
			tokenExpires:
				settings.fair_audience_instagram_token_expires || null,
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
	return apiFetch( {
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	} );
}
