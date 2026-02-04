/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load Facebook connection settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to connection settings
 */
export function loadFacebookSettings() {
	return apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
		return {
			connected: settings.fair_events_facebook_connected || false,
			pageId: settings.fair_events_facebook_page_id || '',
			pageName: settings.fair_events_facebook_page_name || '',
			tokenExpires: settings.fair_events_facebook_token_expires || null,
		};
	});
}

/**
 * Load general settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to general settings
 */
export function loadGeneralSettings() {
	return apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
		return {
			slug: settings.fair_events_slug || 'fair-events',
			enabledPostTypes: settings.fair_events_enabled_post_types || [
				'fair_event',
			],
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
 * Test Facebook connection
 *
 * @return {Promise<Object>} Promise resolving to connection test result
 */
export function testFacebookConnection() {
	return apiFetch({
		path: '/fair-events/v1/facebook/test-connection',
		method: 'POST',
	});
}
