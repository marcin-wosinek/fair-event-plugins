/**
 * Edit component for the Calendar Button Block
 */

import {
	TextControl,
	PanelBody,
	ToggleControl,
	TextareaControl,
	SelectControl,
} from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	calculateDuration,
	calculateEndTime,
	convertToDateOnly,
	calculateDaysInclusive,
	calculateEndDate,
	validateDateTimeOrder,
	getDateTimeValidationError,
} from '../utils/dateTime.js';
import { rruleManager } from '../utils/rruleManager.js';
import RecurringEventsCalendar from './RecurringEventsCalendar.js';

/**
 * Edit component for the Calendar Button Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps();

	const {
		start,
		end,
		allDay,
		description,
		location,
		recurring,
		recurrence,
		syncWithEvent,
	} = attributes;

	// State to track metadata updates
	const [metaUpdateCounter, setMetaUpdateCounter] = useState(0);

	// Detect if we're on a fair_event post type
	const { postType, eventMeta } = useSelect(
		(select) => {
			const { getCurrentPostType } = select('core/editor');
			const { getEditedPostAttribute } = select('core/editor');

			return {
				postType: getCurrentPostType(),
				eventMeta: {
					event_start:
						getEditedPostAttribute('meta')?.event_start || '',
					event_end: getEditedPostAttribute('meta')?.event_end || '',
					event_all_day:
						getEditedPostAttribute('meta')?.event_all_day || false,
				},
			};
		},
		[metaUpdateCounter]
	);

	const isOnFairEvent = postType === 'fair_event';

	// Auto-enable sync when block is first added to a fair_event post
	useEffect(() => {
		if (isOnFairEvent && !syncWithEvent && !start && !end) {
			// Only enable sync if this appears to be a new block (no dates set yet)
			setAttributes({ syncWithEvent: true });
		}
	}, [isOnFairEvent]);

	// Subscribe to metadata changes when sync is enabled
	useEffect(() => {
		if (!syncWithEvent || !isOnFairEvent) {
			return;
		}

		const { subscribe } = wp.data;
		let previousMeta = { ...eventMeta };

		// Subscribe to store changes
		const unsubscribe = subscribe(() => {
			const editor = wp.data.select('core/editor');
			const currentMeta = editor.getEditedPostAttribute('meta');

			// Check if metadata has changed
			if (
				currentMeta?.event_start !== previousMeta.event_start ||
				currentMeta?.event_end !== previousMeta.event_end ||
				currentMeta?.event_all_day !== previousMeta.event_all_day
			) {
				previousMeta = {
					event_start: currentMeta?.event_start || '',
					event_end: currentMeta?.event_end || '',
					event_all_day: currentMeta?.event_all_day || false,
				};

				// Trigger a re-render by updating the counter
				setMetaUpdateCounter((prev) => prev + 1);
			}
		});

		return unsubscribe;
	}, [syncWithEvent, isOnFairEvent]);

	// Sync with event data when toggle is enabled
	useEffect(() => {
		if (syncWithEvent && isOnFairEvent && eventMeta.event_start) {
			setAttributes({
				start: eventMeta.event_start,
				end: eventMeta.event_end,
				allDay: eventMeta.event_all_day,
			});
		}
	}, [
		syncWithEvent,
		isOnFairEvent,
		eventMeta.event_start,
		eventMeta.event_end,
		eventMeta.event_all_day,
	]);

	// Extract recurrence values with defaults
	const frequency = recurrence?.frequency || 'WEEKLY';
	const repeatCount = recurrence?.count || null;
	const untilDate = recurrence?.until || '';

	// State to preserve datetime values when switching between all-day and timed events
	const [preservedStartTime, setPreservedStartTime] = useState('');
	const [preservedEndTime, setPreservedEndTime] = useState('');

	// Duration options for timed events (in minutes)
	const durationOptions = [
		{ label: __('Other', 'fair-calendar-button'), value: 'other' },
		{ label: __('30 minutes', 'fair-calendar-button'), value: '30' },
		{ label: __('1 hour', 'fair-calendar-button'), value: '60' },
		{ label: __('1 hour 30 minutes', 'fair-calendar-button'), value: '90' },
		{ label: __('2 hours', 'fair-calendar-button'), value: '120' },
		{
			label: __('2 hours 30 minutes', 'fair-calendar-button'),
			value: '150',
		},
		{ label: __('3 hours', 'fair-calendar-button'), value: '180' },
		{ label: __('4 hours', 'fair-calendar-button'), value: '240' },
		{ label: __('6 hours', 'fair-calendar-button'), value: '360' },
		{ label: __('8 hours', 'fair-calendar-button'), value: '480' },
	];

	// Length options for all-day events (in days)
	const allDayLengthOptions = [
		{ label: __('Other', 'fair-calendar-button'), value: 'other' },
		{ label: __('1 day', 'fair-calendar-button'), value: '1' },
		{ label: __('2 days', 'fair-calendar-button'), value: '2' },
		{ label: __('3 days', 'fair-calendar-button'), value: '3' },
	];

	// Function to calculate current event duration in minutes
	const calculateCurrentDuration = (startTime, endTime) => {
		return calculateDuration(startTime, endTime);
	};

	// Function to calculate current all-day event length in days
	const calculateCurrentAllDayLength = (startDate, endDate) => {
		return calculateDaysInclusive(startDate, endDate);
	};

	// Get validation status and error message
	const dateTimeValidation = {
		isValid: validateDateTimeOrder(start, end),
		errorMessage: getDateTimeValidationError(start, end, allDay),
	};

	// Handle start time change while maintaining constant duration
	const handleStartTimeChange = (newStartTime) => {
		setAttributes({ start: newStartTime });

		// Only adjust end time if both start and end times exist
		if (end && newStartTime) {
			if (allDay) {
				// For all-day events, maintain the same number of days
				const currentLength = calculateCurrentAllDayLength(start, end);
				if (currentLength !== null && currentLength > 0) {
					const newEndDate = calculateEndDate(
						newStartTime,
						currentLength.toString()
					);
					if (newEndDate) {
						setAttributes({ end: newEndDate });
					}
				}
			} else {
				// For timed events, maintain the same duration in minutes
				const currentDuration = calculateCurrentDuration(start, end);
				if (currentDuration !== null && currentDuration > 0) {
					const newEndTime = calculateEndTime(
						newStartTime,
						currentDuration.toString()
					);
					if (newEndTime) {
						setAttributes({ end: newEndTime });
					}
				}
			}
		}
	};

	// Get current duration selection value for timed events
	const getCurrentDurationSelection = () => {
		if (!start || !end || allDay) {
			return 'other';
		}

		const currentDuration = calculateCurrentDuration(start, end);
		if (currentDuration === null) {
			return 'other';
		}

		// Check if current duration matches any of the predefined options
		const matchingOption = durationOptions.find(
			(option) =>
				option.value !== 'other' &&
				parseInt(option.value) === currentDuration
		);

		return matchingOption ? matchingOption.value : 'other';
	};

	// Get current length selection value for all-day events
	const getCurrentAllDayLengthSelection = () => {
		if (!start || !end || !allDay) {
			return 'other';
		}

		const currentLength = calculateCurrentAllDayLength(start, end);
		if (currentLength === null) {
			return 'other';
		}

		// Check if current length matches any of the predefined options
		const matchingOption = allDayLengthOptions.find(
			(option) =>
				option.value !== 'other' &&
				parseInt(option.value) === currentLength
		);

		return matchingOption ? matchingOption.value : 'other';
	};

	// Update RRULE when components change
	const updateRRule = (newRecurrence = recurrence) => {
		const newRRule = rruleManager.toRRule(newRecurrence);
		setAttributes({ rRule: newRRule });
	};

	// Handle frequency change
	const handleFrequencyChange = (newFrequency) => {
		const newRecurrence = {
			...recurrence,
			frequency: newFrequency,
		};
		setAttributes({ recurrence: newRecurrence });
		updateRRule(newRecurrence);
	};

	// Handle repeat count change
	const handleRepeatCountChange = (newCount) => {
		const count = newCount ? parseInt(newCount) : null;
		const newRecurrence = {
			...recurrence,
			count,
			until: '', // Clear until date when count is set
		};
		setAttributes({ recurrence: newRecurrence });
		updateRRule(newRecurrence);
	};

	// Handle until date change
	const handleUntilDateChange = (newUntilDate) => {
		const newRecurrence = {
			...recurrence,
			until: newUntilDate,
			count: null, // Clear repeat count when until is set
		};
		setAttributes({ recurrence: newRecurrence });
		updateRRule(newRecurrence);
	};

	// Handle allDay toggle while preserving datetime values
	const handleAllDayToggle = (newAllDayValue) => {
		if (newAllDayValue) {
			// Switching to all-day: preserve datetime values and convert to date format
			if (start) {
				setPreservedStartTime(start);
				setAttributes({ start: convertToDateOnly(start) });
			}
			if (end) {
				setPreservedEndTime(end);
				setAttributes({ end: convertToDateOnly(end) });
			}
		} else {
			// Switching to timed event: restore preserved datetime values if available
			if (preservedStartTime) {
				setAttributes({ start: preservedStartTime });
			}
			if (preservedEndTime) {
				setAttributes({ end: preservedEndTime });
			}
		}

		setAttributes({ allDay: newAllDayValue });
	};

	// Handle duration change for timed events
	const handleDurationChange = (duration) => {
		if (duration === 'other') {
			// Don't change the end time, let user set it manually
			return;
		}

		const newEndTime = calculateEndTime(start, duration);
		if (newEndTime) {
			setAttributes({ end: newEndTime });
		}
	};

	// Handle length change for all-day events
	const handleAllDayLengthChange = (length) => {
		if (length === 'other') {
			// Don't change the end date, let user set it manually
			return;
		}

		const newEndDate = calculateEndDate(start, length);
		if (newEndDate) {
			setAttributes({ end: newEndDate });
		}
	};

	const TEMPLATE = [
		[
			'core/button',
			{
				text: __('Add to Calendar', 'fair-calendar-button'),
				url: '',
			},
		],
	];

	// Add wp-block-buttons class to support button width settings
	const innerBlocksProps = useInnerBlocksProps(
		{
			...blockProps,
			className: `${blockProps.className || ''} wp-block-buttons`.trim(),
		},
		{
			template: TEMPLATE,
			templateLock: false,
			allowedBlocks: ['core/button'],
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={__(
						'Calendar Button Settings',
						'fair-calendar-button'
					)}
				>
					{isOnFairEvent && (
						<ToggleControl
							label={__(
								'Keep in sync with event data',
								'fair-calendar-button'
							)}
							checked={syncWithEvent}
							onChange={(value) =>
								setAttributes({ syncWithEvent: value })
							}
							help={__(
								'Automatically use start date, end date, and all-day setting from the event.',
								'fair-calendar-button'
							)}
						/>
					)}
					<ToggleControl
						label={__('All Day Event', 'fair-calendar-button')}
						checked={allDay}
						onChange={handleAllDayToggle}
						disabled={syncWithEvent && isOnFairEvent}
					/>
					<TextControl
						label={
							allDay
								? __('Start Date', 'fair-calendar-button')
								: __('Start Date/Time', 'fair-calendar-button')
						}
						value={start}
						onChange={
							allDay
								? handleStartTimeChange
								: handleStartTimeChange
						}
						type={allDay ? 'date' : 'datetime-local'}
						disabled={syncWithEvent && isOnFairEvent}
					/>
					{allDay && (
						<SelectControl
							label={__('Event Length', 'fair-calendar-button')}
							value={getCurrentAllDayLengthSelection()}
							options={allDayLengthOptions}
							onChange={handleAllDayLengthChange}
							disabled={syncWithEvent && isOnFairEvent}
						/>
					)}
					{!allDay && (
						<SelectControl
							label={__('Event Length', 'fair-calendar-button')}
							value={getCurrentDurationSelection()}
							options={durationOptions}
							onChange={handleDurationChange}
							disabled={syncWithEvent && isOnFairEvent}
						/>
					)}
					<TextControl
						label={
							allDay
								? __('End Date', 'fair-calendar-button')
								: __('End Date/Time', 'fair-calendar-button')
						}
						value={end}
						onChange={(value) => setAttributes({ end: value })}
						type={allDay ? 'date' : 'datetime-local'}
						disabled={syncWithEvent && isOnFairEvent}
						className={
							!dateTimeValidation.isValid
								? 'has-error'
								: undefined
						}
						help={
							!dateTimeValidation.isValid
								? dateTimeValidation.errorMessage
								: undefined
						}
					/>
					<TextareaControl
						label={__('Description', 'fair-calendar-button')}
						value={description}
						onChange={(value) =>
							setAttributes({ description: value })
						}
					/>
					<TextControl
						label={__('Location', 'fair-calendar-button')}
						value={location}
						onChange={(value) => setAttributes({ location: value })}
					/>
					<ToggleControl
						label={__('Recurring Event', 'fair-calendar-button')}
						checked={recurring}
						onChange={(value) =>
							setAttributes({ recurring: value })
						}
						help={__(
							'Enable this to set up a recurring event with an iCal recurrence rule.',
							'fair-calendar-button'
						)}
					/>
					{recurring && (
						<>
							<SelectControl
								label={__('Frequency', 'fair-calendar-button')}
								value={frequency}
								options={[
									{
										label: __(
											'Daily',
											'fair-calendar-button'
										),
										value: 'DAILY',
									},
									{
										label: __(
											'Weekly',
											'fair-calendar-button'
										),
										value: 'WEEKLY',
									},
									{
										label: __(
											'Biweekly',
											'fair-calendar-button'
										),
										value: 'BIWEEKLY',
									},
								]}
								onChange={handleFrequencyChange}
								help={__(
									'How often the event repeats.',
									'fair-calendar-button'
								)}
							/>
							<TextControl
								label={__(
									'Number of Repetitions',
									'fair-calendar-button'
								)}
								type="number"
								value={repeatCount || ''}
								onChange={handleRepeatCountChange}
								help={__(
									'Leave empty for unlimited repetitions, or set "Until Date" below.',
									'fair-calendar-button'
								)}
								min={1}
							/>
							<TextControl
								label={__('Until Date', 'fair-calendar-button')}
								type="date"
								value={untilDate}
								onChange={handleUntilDateChange}
								help={__(
									'Leave empty for unlimited repetitions, or set "Number of Repetitions" above.',
									'fair-calendar-button'
								)}
							/>

							<RecurringEventsCalendar
								startDate={start}
								recurrence={recurrence}
							/>
						</>
					)}
				</PanelBody>
			</InspectorControls>
			<div {...innerBlocksProps} />
		</>
	);
}
