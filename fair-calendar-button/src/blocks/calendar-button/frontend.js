import {
	createEventData,
	handleCalendarClick,
} from './utils/calendar-handler.js';

// Import styles
import './view.css';

document.addEventListener('DOMContentLoaded', function () {
	const calendarButtons = document.querySelectorAll(
		'.wp-block-fair-calendar-button-calendar-button .wp-block-button__link'
	);

	calendarButtons.forEach((button) => {
		button.addEventListener('click', function (e) {
			e.preventDefault();

			// Get event data from button data attributes
			let exceptionDates = [];
			try {
				exceptionDates = this.dataset.exceptionDates
					? JSON.parse(this.dataset.exceptionDates)
					: [];
			} catch (e) {
				console.warn('Failed to parse exception dates:', e);
				exceptionDates = [];
			}

			const attributes = {
				start: this.dataset.start,
				end: this.dataset.end,
				description: this.dataset.description || '',
				location: this.dataset.location || '',
				allDay: this.dataset.allDay === 'true',
				title: this.dataset.title,
				recurring: this.dataset.recurring === 'true',
				rRule: this.dataset.rrule || '',
				exdate: this.dataset.exdate || '',
				exceptionDates,
				url: this.dataset.url || '',
			};

			// Create calendar event data and handle click
			const eventData = createEventData(attributes);
			handleCalendarClick(eventData, this);
		});
	});
});
