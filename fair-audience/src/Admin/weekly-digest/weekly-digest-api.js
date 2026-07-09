/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load the weekly digest config plus last-run info.
 *
 * @return {Promise<Object>} Promise resolving to `{ config, last_sent_week, last_run_result }`.
 */
export function getDigestConfig() {
	return apiFetch({ path: '/fair-audience/v1/weekly-digest' });
}

/**
 * Save the weekly digest config.
 *
 * @param {Object} config Config fields to update.
 * @return {Promise<Object>} Promise resolving to `{ config }`.
 */
export function saveDigestConfig(config) {
	return apiFetch({
		path: '/fair-audience/v1/weekly-digest',
		method: 'PUT',
		data: config,
	});
}

/**
 * Load the enabled fair-events sources available to pick from.
 *
 * @return {Promise<Array>} Promise resolving to a list of `{ slug, name }`.
 */
export function getDigestSources() {
	return apiFetch({ path: '/fair-audience/v1/weekly-digest/sources' });
}

/**
 * Render the configured week's digest HTML without sending it.
 *
 * @return {Promise<Object>} Promise resolving to `{ subject, html, week, empty }`.
 */
export function previewDigest() {
	return apiFetch({
		path: '/fair-audience/v1/weekly-digest/preview',
		method: 'POST',
	});
}

/**
 * Render and send one digest email to the current admin.
 *
 * @return {Promise<Object>} Promise resolving to `{ sent_to }`.
 */
export function sendTestDigest() {
	return apiFetch({
		path: '/fair-audience/v1/weekly-digest/test',
		method: 'POST',
	});
}
