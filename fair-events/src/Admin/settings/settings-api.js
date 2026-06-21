/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load general settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to general settings
 */
export function loadGeneralSettings() {
	return apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
		return {
			slug: settings.fair_events_slug || 'fair-events',
			enabledPostTypes: settings.fair_events_enabled_post_types || [],
			registerPostType: settings.fair_events_register_post_type ?? true,
			poweredByBranding:
				settings.fair_events_powered_by_branding ?? false,
			startOfWeek: settings.fair_events_start_of_week ?? 1,
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
