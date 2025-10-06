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
			// Store current values
			startInput.dataset.timeValue = startInput.value;
			endInput.dataset.timeValue = endInput.value;

			// Remove time portion (keep only date)
			if (startInput.value) {
				startInput.value = startInput.value.split('T')[0];
			}
			if (endInput.value) {
				endInput.value = endInput.value.split('T')[0];
			}

			// Change input type to date
			startInput.type = 'date';
			endInput.type = 'date';
		} else {
			// Restore to datetime-local
			startInput.type = 'datetime-local';
			endInput.type = 'datetime-local';

			// Restore previous values if they exist
			if (startInput.dataset.timeValue) {
				startInput.value = startInput.dataset.timeValue;
			}
			if (endInput.dataset.timeValue) {
				endInput.value = endInput.dataset.timeValue;
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
