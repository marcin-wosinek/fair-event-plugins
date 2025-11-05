/**
 * Dynamic Date Registry
 *
 * Provides access to dynamic date options registered by various Fair Event plugins
 * through the WordPress REST API.
 *
 * @package FairEventsShared
 */

import apiFetch from '@wordpress/api-fetch';

/**
 * Cache for dynamic date options to avoid repeated API calls
 */
let cachedOptions = null;
let fetchPromise = null;

/**
 * Fetch dynamic date options from the REST API
 *
 * Returns cached options if already fetched, otherwise makes an API call.
 * Multiple simultaneous calls will share the same promise to avoid
 * duplicate requests.
 *
 * @return {Promise<Array>} Promise resolving to array of date options.
 *                          Each option has { value, label } structure.
 */
export async function getDynamicDateOptions() {
	// Return cached options if available
	if (cachedOptions !== null) {
		return cachedOptions;
	}

	// Return existing promise if fetch is in progress
	if (fetchPromise !== null) {
		return fetchPromise;
	}

	// Start new fetch
	fetchPromise = apiFetch({ path: '/fair-events/v1/date-options' })
		.then((response) => {
			if (response.success && Array.isArray(response.options)) {
				cachedOptions = response.options;
				return cachedOptions;
			}
			// Fallback to empty array if response format is unexpected
			cachedOptions = [];
			return cachedOptions;
		})
		.catch((error) => {
			console.error('Failed to fetch dynamic date options:', error);
			// Return empty array on error
			cachedOptions = [];
			return cachedOptions;
		})
		.finally(() => {
			// Clear promise reference
			fetchPromise = null;
		});

	return fetchPromise;
}

/**
 * Clear the cached date options
 *
 * Use this if you need to force a refresh of the options,
 * for example after a plugin is activated/deactivated.
 *
 * @return {void}
 */
export function clearDynamicDateCache() {
	cachedOptions = null;
	fetchPromise = null;
}

/**
 * Check if a date string is a dynamic date format
 *
 * Dynamic dates follow the pattern: {plugin-slug}:{key}
 * Examples: 'fair-event:start', 'fair-membership:expiry'
 *
 * @param {string} dateString The date string to check.
 * @return {boolean} True if the string appears to be a dynamic date format.
 */
export function isDynamicDate(dateString) {
	if (typeof dateString !== 'string') {
		return false;
	}
	// Check for the pattern: word-characters:word-characters
	return /^[a-z0-9-]+:[a-z0-9-]+$/i.test(dateString);
}
