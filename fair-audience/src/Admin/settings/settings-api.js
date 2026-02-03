/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load Instagram connection settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to connection settings
 */
export function loadInstagramSettings() {
	return apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
		return {
			connected: settings.fair_audience_instagram_connected || false,
			username: settings.fair_audience_instagram_username || '',
			userId: settings.fair_audience_instagram_user_id || '',
			tokenExpires:
				settings.fair_audience_instagram_token_expires || null,
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
	return apiFetch({
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	});
}

/**
 * Test Instagram connection
 *
 * @return {Promise<Object>} Promise resolving to connection test result
 */
export function testInstagramConnection() {
	return apiFetch({
		path: '/fair-audience/v1/instagram/test-connection',
		method: 'POST',
	});
}
