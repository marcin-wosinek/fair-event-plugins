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

	// Recurrence elements
	const recurrenceEnabledCheckbox = document.getElementById(
		'event_recurrence_enabled'
	);
	const recurrenceOptions = document.getElementById('recurrence_options');
	const recurrenceFrequency = document.getElementById(
		'event_recurrence_frequency'
	);
	const recurrenceEndType = document.getElementById(
		'event_recurrence_end_type'
	);
	const recurrenceCount = document.getElementById('event_recurrence_count');
	const recurrenceCountWrapper = document.getElementById(
		'recurrence_count_wrapper'
	);
	const recurrenceUntil = document.getElementById('event_recurrence_until');
	const recurrenceUntilWrapper = document.getElementById(
		'recurrence_until_wrapper'
	);
	const recurrenceHiddenInput = document.getElementById('event_recurrence');

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
			const meta = {
				event_start: startInput.value,
				event_end: endInput.value,
				event_all_day: allDayCheckbox.checked,
				event_location: locationInput.value,
			};

			// Include recurrence if the field exists
			const recurrenceInput = document.getElementById('event_recurrence');
			if (recurrenceInput) {
				meta.event_recurrence = recurrenceInput.value;
			}

			editPost({ meta });
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

	// Recurrence handling
	if (recurrenceEnabledCheckbox && recurrenceOptions) {
		/**
		 * Build RRULE string from form fields
		 */
		function buildRRule() {
			if (!recurrenceEnabledCheckbox.checked) {
				return '';
			}

			const frequency = recurrenceFrequency?.value || 'weekly';
			const endType = recurrenceEndType?.value || 'count';
			const count = recurrenceCount?.value || 10;
			const until = recurrenceUntil?.value || '';

			// Map simplified frequency to RRULE
			let freq = 'WEEKLY';
			let interval = 1;

			switch (frequency) {
				case 'daily':
					freq = 'DAILY';
					interval = 1;
					break;
				case 'weekly':
					freq = 'WEEKLY';
					interval = 1;
					break;
				case 'biweekly':
					freq = 'WEEKLY';
					interval = 2;
					break;
				case 'monthly':
					freq = 'MONTHLY';
					interval = 1;
					break;
			}

			const parts = [`FREQ=${freq}`];

			if (interval > 1) {
				parts.push(`INTERVAL=${interval}`);
			}

			if (endType === 'count' && count) {
				parts.push(`COUNT=${count}`);
			} else if (endType === 'until' && until) {
				// Convert Y-m-d to YYYYMMDD
				const untilFormatted = until.replace(/-/g, '');
				parts.push(`UNTIL=${untilFormatted}`);
			}

			return parts.join(';');
		}

		/**
		 * Update the hidden RRULE input
		 */
		function updateRRuleInput() {
			if (recurrenceHiddenInput) {
				recurrenceHiddenInput.value = buildRRule();
			}
			updateEditorMeta();
		}

		/**
		 * Toggle recurrence options visibility
		 */
		function toggleRecurrenceOptions() {
			if (recurrenceOptions) {
				recurrenceOptions.style.display =
					recurrenceEnabledCheckbox.checked ? '' : 'none';
			}
			updateRRuleInput();
		}

		/**
		 * Toggle end type fields
		 */
		function toggleEndTypeFields() {
			const endType = recurrenceEndType?.value || 'count';

			if (recurrenceCountWrapper) {
				recurrenceCountWrapper.style.display =
					endType === 'count' ? '' : 'none';
			}
			if (recurrenceUntilWrapper) {
				recurrenceUntilWrapper.style.display =
					endType === 'until' ? '' : 'none';
			}
			updateRRuleInput();
		}

		// Event listeners for recurrence fields
		recurrenceEnabledCheckbox.addEventListener(
			'change',
			toggleRecurrenceOptions
		);

		if (recurrenceFrequency) {
			recurrenceFrequency.addEventListener('change', updateRRuleInput);
		}

		if (recurrenceEndType) {
			recurrenceEndType.addEventListener('change', toggleEndTypeFields);
		}

		if (recurrenceCount) {
			recurrenceCount.addEventListener('change', updateRRuleInput);
			recurrenceCount.addEventListener('input', updateRRuleInput);
		}

		if (recurrenceUntil) {
			recurrenceUntil.addEventListener('change', updateRRuleInput);
		}
	}
});
