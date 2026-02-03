/**
 * Calendar Button - Frontend Script
 *
 * Handles calendar button clicks on the frontend.
 * Reads event data from data attributes and shows calendar provider dropdown.
 */

import {
	createEventData,
	handleCalendarClick,
} from './utils/calendar-handler.js';

// Import styles
import './frontend.css';

(function () {
	'use strict';

	// Defensive: handle both scenarios (DOM loading or already loaded)
	if (document.readyState === 'loading') {
		document.addEventListener(
			'DOMContentLoaded',
			initializeCalendarButtons
		);
	} else {
		initializeCalendarButtons();
	}

	function initializeCalendarButtons() {
		// Find all buttons with calendar data attribute
		const calendarButtons = document.querySelectorAll(
			'a.wp-block-button__link[data-calendar-button="true"]'
		);

		calendarButtons.forEach((button) => {
			button.addEventListener('click', function (e) {
				e.preventDefault();

				// Get event data from button data attributes
				const attributes = {
					start: button.dataset.start,
					end: button.dataset.end,
					description: button.dataset.description || '',
					location: button.dataset.location || '',
					allDay: button.dataset.allDay === 'true',
					title: button.dataset.title,
					recurring: button.dataset.recurring === 'true',
					rRule: button.dataset.rrule || '',
					url: button.dataset.url || '',
				};

				// Create calendar event data and handle click
				const eventData = createEventData(attributes);
				handleCalendarClick(eventData, this);
			});
		});
	}
})();
