import {
	createEventData,
	handleCalendarClick,
} from './utils/calendar-handler.js';

// Import styles
import './frontend.css';

document.addEventListener('DOMContentLoaded', function () {
	const calendarContainers = document.querySelectorAll(
		'.calendar-button-container'
	);

	calendarContainers.forEach((container) => {
		const button = container.querySelector('.wp-block-button__link');

		if (button) {
			button.addEventListener('click', function (e) {
				e.preventDefault();

				// Get event data from container data attributes
				const attributes = {
					start: container.dataset.start,
					end: container.dataset.end,
					description: container.dataset.description || '',
					location: container.dataset.location || '',
					allDay: container.dataset.allDay === 'true',
					title: container.dataset.title,
					recurring: container.dataset.recurring === 'true',
					rRule: container.dataset.rrule || '',
					url: container.dataset.url || '',
				};

				// Create calendar event data and handle click
				const eventData = createEventData(attributes);
				handleCalendarClick(eventData, this);
			});
		}
	});
});
