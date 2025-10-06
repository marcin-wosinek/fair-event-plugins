/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';

/**
 * Event Meta Box JavaScript
 *
 * Handles UI logic for the event metadata fields
 */
domReady(() => {
	const allDayCheckbox = document.getElementById('event_all_day');
	const startInput = document.getElementById('event_start');
	const endInput = document.getElementById('event_end');

	if (!allDayCheckbox || !startInput || !endInput) {
		return;
	}

	/**
	 * Toggle time inputs based on all-day checkbox
	 */
	function toggleTimeInputs() {
		const isAllDay = allDayCheckbox.checked;

		if (isAllDay) {
			// Store current full datetime values before switching
			if (startInput.type === 'datetime-local' && startInput.value) {
				startInput.dataset.datetimeValue = startInput.value;
			}
			if (endInput.type === 'datetime-local' && endInput.value) {
				endInput.dataset.datetimeValue = endInput.value;
			}

			// Get current values (date portion only)
			const startDate = startInput.value
				? startInput.value.split('T')[0]
				: '';
			const endDate = endInput.value ? endInput.value.split('T')[0] : '';

			// Change input type to date
			startInput.type = 'date';
			endInput.type = 'date';

			// Set date-only values
			startInput.value = startDate;
			endInput.value = endDate;
		} else {
			// Store current date values before switching
			if (startInput.type === 'date' && startInput.value) {
				startInput.dataset.dateValue = startInput.value;
			}
			if (endInput.type === 'date' && endInput.value) {
				endInput.dataset.dateValue = endInput.value;
			}

			// Change input type to datetime-local
			startInput.type = 'datetime-local';
			endInput.type = 'datetime-local';

			// Restore previous datetime values if they exist
			if (startInput.dataset.datetimeValue) {
				startInput.value = startInput.dataset.datetimeValue;
			} else if (startInput.dataset.dateValue) {
				// Add default time (00:00) if only date exists
				startInput.value = startInput.dataset.dateValue + 'T00:00';
			}

			if (endInput.dataset.datetimeValue) {
				endInput.value = endInput.dataset.datetimeValue;
			} else if (endInput.dataset.dateValue) {
				// Add default time (23:59) for end date
				endInput.value = endInput.dataset.dateValue + 'T23:59';
			}
		}
	}

	/**
	 * Validate that end date is after start date
	 */
	function validateDates() {
		if (!startInput.value || !endInput.value) {
			return;
		}

		const start = new Date(startInput.value);
		const end = new Date(endInput.value);

		if (end < start) {
			endInput.setCustomValidity('End date must be after start date');
		} else {
			endInput.setCustomValidity('');
		}
	}

	// Initialize state based on checkbox
	toggleTimeInputs();

	// Listen for checkbox changes
	allDayCheckbox.addEventListener('change', toggleTimeInputs);

	// Validate dates on input
	startInput.addEventListener('change', validateDates);
	endInput.addEventListener('change', validateDates);
});
