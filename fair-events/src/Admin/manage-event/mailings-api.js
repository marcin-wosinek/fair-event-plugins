/**
 * REST client for scheduled per-event mailings.
 *
 * All calls hit fair-audience's scheduled-messages endpoints (the Mailings tab
 * lives in fair-events but the data model is owned by fair-audience). Paths are
 * hardcoded and start with '/' per the project's apiFetch conventions.
 */

/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * List scheduled messages for an event.
 *
 * @param {number} eventId Event post ID.
 * @return {Promise<Array>} Promise resolving to the message list.
 */
export function loadScheduledMessages(eventId) {
	return apiFetch({
		path: `/fair-audience/v1/events/${eventId}/scheduled-messages`,
	});
}

/**
 * List an event's dates for the anchor picker.
 *
 * @param {number} eventId Event post ID.
 * @return {Promise<Array>} Promise resolving to the event-date list.
 */
export function loadEventDates(eventId) {
	return apiFetch({
		path: `/fair-audience/v1/events/${eventId}/event-dates`,
	});
}

/**
 * Create a scheduled message.
 *
 * @param {number} eventId Event post ID.
 * @param {Object} data    Message payload.
 * @return {Promise<Object>} Promise resolving to the created message.
 */
export function createScheduledMessage(eventId, data) {
	return apiFetch({
		path: `/fair-audience/v1/events/${eventId}/scheduled-messages`,
		method: 'POST',
		data,
	});
}

/**
 * Update a scheduled message (only while status=scheduled).
 *
 * @param {number} id   Message ID.
 * @param {Object} data Message payload.
 * @return {Promise<Object>} Promise resolving to the updated message.
 */
export function updateScheduledMessage(id, data) {
	return apiFetch({
		path: `/fair-audience/v1/scheduled-messages/${id}`,
		method: 'PUT',
		data,
	});
}

/**
 * Cancel a scheduled message (only while status=scheduled).
 *
 * @param {number} id Message ID.
 * @return {Promise<Object>} Promise resolving to the canceled message.
 */
export function cancelScheduledMessage(id) {
	return apiFetch({
		path: `/fair-audience/v1/scheduled-messages/${id}`,
		method: 'DELETE',
	});
}

/**
 * Resolve recipients for a stored message, as of now.
 *
 * @param {number} id Message ID.
 * @return {Promise<Array>} Promise resolving to the recipient list.
 */
export function previewRecipients(id) {
	return apiFetch({
		path: `/fair-audience/v1/scheduled-messages/${id}/preview-recipients`,
		method: 'POST',
	});
}

/**
 * Resolve recipients for an unsaved draft from a filter.
 *
 * @param {number} eventId          Event post ID.
 * @param {Object} recipientsFilter Filter: { labels, group_ids, is_marketing }.
 * @return {Promise<Array>} Promise resolving to the recipient list.
 */
export function previewDraftRecipients(eventId, recipientsFilter) {
	return apiFetch({
		path: `/fair-audience/v1/events/${eventId}/scheduled-messages/preview-recipients`,
		method: 'POST',
		data: { recipients_filter: recipientsFilter },
	});
}

/**
 * Load groups for the recipient filter.
 *
 * @return {Promise<Array>} Promise resolving to the group list.
 */
export function loadGroups() {
	return apiFetch({ path: '/fair-audience/v1/custom-mail/groups' });
}
