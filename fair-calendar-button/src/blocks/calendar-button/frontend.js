import {
	createEventData,
	handleCalendarClick,
} from './utils/calendar-handler.js';

document.addEventListener('DOMContentLoaded', function () {
	const calendarButtons = document.querySelectorAll(
		'.wp-block-fair-calendar-button-calendar-button button'
	);

	calendarButtons.forEach((button) => {
		button.addEventListener('click', function (e) {
			e.preventDefault();

			// Get event data from button data attributes
			const attributes = {
				start: this.dataset.start,
				end: this.dataset.end,
				description: this.dataset.description || '',
				location: this.dataset.location || '',
				allDay: this.dataset.allDay === 'true',
				url: this.dataset.url,
				title: this.dataset.title,
			};

			// Create calendar event data and handle click
			const eventData = createEventData(attributes);
			handleCalendarClick(eventData);
		});
	});
});
