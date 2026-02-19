/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load all custom mail messages from the REST API
 *
 * @return {Promise<Array>} Promise resolving to array of messages
 */
export function loadCustomMails() {
	return apiFetch({ path: '/fair-audience/v1/custom-mail' });
}

/**
 * Send a custom mail
 *
 * @param {Object}  data               Mail data
 * @param {string}  data.subject       Email subject
 * @param {string}  data.content       Email content (HTML)
 * @param {number}  data.event_date_id Event date ID
 * @param {boolean} data.is_marketing  Whether to filter by marketing consent
 * @return {Promise<Object>} Promise resolving to send results
 */
export function sendCustomMail(data) {
	return apiFetch({
		path: '/fair-audience/v1/custom-mail',
		method: 'POST',
		data,
	});
}

/**
 * Load event dates for dropdown
 *
 * @return {Promise<Array>} Promise resolving to array of event dates
 */
export function loadEventDates() {
	return apiFetch({ path: '/fair-audience/v1/custom-mail/events' });
}

/**
 * Preview recipients for a custom mail
 *
 * @param {Object}  data               Preview data
 * @param {number}  data.event_date_id Event date ID (0 for all audience)
 * @param {boolean} data.is_marketing  Whether to filter by marketing consent
 * @param {Array}   data.labels        Labels to include
 * @return {Promise<Array>} Promise resolving to array of recipients
 */
export function previewRecipients(data) {
	return apiFetch({
		path: '/fair-audience/v1/custom-mail/preview',
		method: 'POST',
		data,
	});
}

/**
 * Delete a custom mail message record
 *
 * @param {number} id Message ID
 * @return {Promise<Object>} Promise resolving to deletion result
 */
export function deleteCustomMail(id) {
	return apiFetch({
		path: `/fair-audience/v1/custom-mail/${id}`,
		method: 'DELETE',
	});
}
