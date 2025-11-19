/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { __ } from '@wordpress/i18n';

/**
 * Fair Events Shared dependencies
 */
import { DurationOptions, calculateDuration } from 'fair-events-shared';

/**
 * Event Meta Box JavaScript
 *
 * Handles UI logic for the event metadata fields
 */
domReady(() => {
	const allDayCheckbox = document.getElementById('event_all_day');
	const startInput = document.getElementById('event_start');
	const endInput = document.getElementById('event_end');
	const locationInput = document.getElementById('event_location');
	const durationSelect = document.getElementById('event_duration');

	if (
		!allDayCheckbox ||
		!startInput ||
		!endInput ||
		!locationInput ||
		!durationSelect
	) {
		return;
	}

	// Duration options for timed events (in minutes)
	const timedDurationOptions = new DurationOptions({
		values: [30, 60, 90, 120, 150, 180, 240, 360, 480],
		unit: 'minutes',
		textDomain: 'fair-events',
	});

	// Duration options for all-day events (in days)
	const allDayDurationOptions = new DurationOptions({
		values: [1, 2, 3, 4, 5, 6, 7],
		unit: 'days',
		textDomain: 'fair-events',
	});

	/**
	 * Populate duration select with options based on all-day state
	 */
	function populateDurationOptions() {
		const isAllDay = allDayCheckbox.checked;
		const options = isAllDay
			? allDayDurationOptions.getDurationOptions()
			: timedDurationOptions.getDurationOptions();

		// Clear existing options
		durationSelect.innerHTML = '';

		// Add options
		options.forEach((option) => {
			const optionElement = document.createElement('option');
			optionElement.value = option.value;
			optionElement.textContent = option.label;
			durationSelect.appendChild(optionElement);
		});

		// Update current selection
		updateDurationSelection();
	}

	/**
	 * Calculate days between two dates (inclusive)
	 */
	function calculateDaysInclusive(startDate, endDate) {
		if (!startDate || !endDate) return null;
		const start = new Date(startDate);
		const end = new Date(endDate);
		const diffTime = end - start;
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
		return diffDays;
	}

	/**
	 * Update duration selection based on current start/end times
	 */
	function updateDurationSelection() {
		if (!startInput.value || !endInput.value) {
			durationSelect.value = 'other';
			return;
		}

		const isAllDay = allDayCheckbox.checked;

		if (isAllDay) {
			const days = calculateDaysInclusive(
				startInput.value,
				endInput.value
			);
			if (days === null) {
				durationSelect.value = 'other';
			} else {
				const selection =
					allDayDurationOptions.getCurrentSelection(days);
				durationSelect.value = selection;
			}
		} else {
			const minutes = calculateDuration(startInput.value, endInput.value);
			if (minutes === null) {
				durationSelect.value = 'other';
			} else {
				const selection =
					timedDurationOptions.getCurrentSelection(minutes);
				durationSelect.value = selection;
			}
		}
	}

	/**
	 * Format date as YYYY-MM-DD in local timezone
	 */
	function formatDateLocal(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	/**
	 * Format date as YYYY-MM-DDTHH:mm in local timezone
	 */
	function formatDateTimeLocal(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	/**
	 * Handle duration change and update end time
	 */
	function handleDurationChange() {
		if (!startInput.value || durationSelect.value === 'other') {
			return;
		}

		const isAllDay = allDayCheckbox.checked;

		if (isAllDay) {
			// Calculate end date for all-day events
			const days = parseInt(durationSelect.value);
			const start = new Date(startInput.value);
			const end = new Date(start);
			end.setDate(start.getDate() + days - 1); // -1 because it's inclusive
			endInput.value = formatDateLocal(end);
		} else {
			// Calculate end time for timed events
			const minutes = parseInt(durationSelect.value);
			const start = new Date(startInput.value);
			const end = new Date(start.getTime() + minutes * 60000);
			endInput.value = formatDateTimeLocal(end);
		}

		validateDates();
		updateEditorMeta();
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

		// Update duration options when switching between all-day and timed
		populateDurationOptions();
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
			endInput.setCustomValidity(
				__('End date must be after start date', 'fair-events')
			);
		} else {
			endInput.setCustomValidity('');
		}
	}

	// Initialize state based on checkbox
	toggleTimeInputs();
	// Initialize duration options
	populateDurationOptions();

	/**
	 * Update the WordPress editor store with new meta values
	 */
	function updateEditorMeta() {
		if (typeof wp !== 'undefined' && wp.data && wp.data.dispatch) {
			const { editPost } = wp.data.dispatch('core/editor');
			editPost({
				meta: {
					event_start: startInput.value,
					event_end: endInput.value,
					event_all_day: allDayCheckbox.checked,
					event_location: locationInput.value,
				},
			});
		}
	}

	// Listen for checkbox changes
	allDayCheckbox.addEventListener('change', () => {
		toggleTimeInputs();
		updateEditorMeta();
	});

	// Handle duration selection changes
	durationSelect.addEventListener('change', handleDurationChange);

	// Validate dates on input and update duration selection
	startInput.addEventListener('change', () => {
		validateDates();
		updateDurationSelection();
		updateEditorMeta();
	});
	endInput.addEventListener('change', () => {
		validateDates();
		updateDurationSelection();
		updateEditorMeta();
	});

	// Update location changes to editor store
	locationInput.addEventListener('change', () => {
		updateEditorMeta();
	});
});
