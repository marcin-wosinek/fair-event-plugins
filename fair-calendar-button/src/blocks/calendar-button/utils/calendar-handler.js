/**
 * Calendar utility functions
 */

import { google } from 'calendar-link';

/**
 * Handle calendar button click
 *
 * @param {Object} eventData - Event data object
 */
export function handleCalendarClick(eventData) {
	try {
		const googleCalendarUrl = google(eventData);
		window.open(googleCalendarUrl, '_blank');
	} catch (error) {
		console.error('Error creating calendar link:', error);
	}
}

/**
 * Convert block attributes to calendar event data
 *
 * @param {Object} attributes - Block attributes
 * @return {Object} Event data for calendar-link
 */
export function createEventData(attributes) {
	const {
		start,
		end,
		allDay,
		description,
		location,
		title,
		recurring,
		rRule,
	} = attributes;
	const eventData = {};

	if (start) eventData.start = new Date(start);
	if (end) eventData.end = new Date(end);
	if (allDay) eventData.allDay = true;
	if (description) eventData.description = description;
	if (location) eventData.location = location;
	if (title) eventData.title = title;

	// Include rRule if recurring is enabled and rRule is provided
	if (recurring && rRule) {
		eventData.rRule = rRule;
	}

	return eventData;
}
