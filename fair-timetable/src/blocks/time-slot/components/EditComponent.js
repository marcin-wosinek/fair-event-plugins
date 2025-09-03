/**
 * Edit component for the Time Slot Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import {
	parse,
	addHours,
	format,
	differenceInHours,
	differenceInMinutes,
	addDays,
	isAfter,
} from 'date-fns';

// Import utilities
import { formatLengthLabel } from '@utils/lengths.js';
import { HourlyRange } from '@utils/hourly-range.js';

/**
 * Edit component for the Time Slot Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, context }) {
	const { startTime, endTime } = attributes;
	const { 'fair-timetable/startTime': timetableStartTime } = context || {};

	// Create HourlyRange object from attributes for later use
	const timeSlotRange = new HourlyRange({ startTime, endTime });

	// Calculate offset from timetable start in hours
	const calculateOffset = (timetableStart, slotStart) => {
		if (!timetableStart || !slotStart) return 0;

		var now = new Date();
		const timetableStartDate = parse(timetableStart, 'HH:mm', now);
		const slotStartDate = parse(slotStart, 'HH:mm', now);

		// If slot start is before timetable start, assume next day
		let hourDiffence =
			differenceInMinutes(slotStartDate, timetableStartDate) / 60;
		if (hourDiffence < 0) {
			hourDiffence += 24;
		}

		return hourDiffence;
	};

	const timeSlotOffset = calculateOffset(timetableStartTime, startTime);

	const blockProps = useBlockProps({
		className: 'time-slot-container',
		style: {
			'--time-slot-length': timeSlotRange.getDuration(),
			'--time-slot-offset': timeSlotOffset,
		},
	});

	// Function to calculate current length in hours from start/end times
	const calculateCurrentLength = (startTime, endTime) => {
		const startDate = parse(startTime, 'HH:mm', new Date());
		let endDate = parse(endTime, 'HH:mm', new Date());

		// If end time is before start time, assume next day
		if (!isAfter(endDate, startDate)) {
			endDate = addDays(endDate, 1);
		}

		return (
			differenceInHours(endDate, startDate) +
			(differenceInMinutes(endDate, startDate) % 60) / 60
		);
	};

	// Generate base length options (0.5h to 4h)
	const baseLengthOptions = [
		{ label: __('30 minutes', 'fair-timetable'), value: 0.5 },
		{ label: __('1 hour', 'fair-timetable'), value: 1 },
		{ label: __('1 hour, 30 minutes', 'fair-timetable'), value: 1.5 },
		{ label: __('2 hours', 'fair-timetable'), value: 2 },
		{ label: __('2 hours, 30 minutes', 'fair-timetable'), value: 2.5 },
		{ label: __('3 hours', 'fair-timetable'), value: 3 },
		{ label: __('3 hours, 30 minutes', 'fair-timetable'), value: 3.5 },
		{ label: __('4 hours', 'fair-timetable'), value: 4 },
	];

	// Calculate current length from start/end times
	const currentCalculatedLength = timeSlotRange.getDuration();

	// Check if current length matches any base option
	const hasMatchingOption = baseLengthOptions.some(
		(option) => Math.abs(option.value - currentCalculatedLength) < 0.01
	);

	// Generate complete length options including custom value if needed
	const lengthOptions = [...baseLengthOptions];
	if (!hasMatchingOption && currentCalculatedLength > 0) {
		lengthOptions.push({
			label: formatLengthLabel(currentCalculatedLength),
			value: currentCalculatedLength,
		});
		// Sort options by value
		lengthOptions.sort((a, b) => a.value - b.value);
	}

	// Function to calculate end hour from start hour and length
	const calculateEndTime = (startTime, lengthHours) => {
		const startDate = parse(startTime, 'HH:mm', new Date());
		const endDate = addHours(startDate, lengthHours);
		return format(endDate, 'HH:mm');
	};

	// Handle start time change while maintaining constant length
	const handleStartTimeChange = (newStartTime) => {
		const newEndTime = calculateEndTime(
			newStartTime,
			currentCalculatedLength
		);
		setAttributes({
			startTime: newStartTime,
			endTime: newEndTime,
		});
	};

	// Handle length change while keeping start time constant
	const handleLengthChange = (newLength) => {
		const newEndTime = calculateEndTime(startTime, newLength);
		setAttributes({
			length: parseFloat(newLength),
			endTime: newEndTime,
		});
	};

	// Handle end time change and recalculate length
	const handleEndTimeChange = (newEndTime) => {
		const newLength = calculateCurrentLength(startTime, newEndTime);
		setAttributes({
			endTime: newEndTime,
			length: newLength,
		});
	};

	// Template for allowed inner blocks (basic content blocks)
	const allowedBlocks = [
		'core/heading',
		'core/paragraph',
		'core/list',
		'core/group',
	];

	// Default template with h3 and paragraph
	const template = [
		[
			'core/heading',
			{
				level: 3,
				content: __('Event Title', 'fair-timetable'),
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'time-slot-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Time Slot Settings', 'fair-timetable')}>
					<TextControl
						label={__('Start Time', 'fair-timetable')}
						value={startTime}
						onChange={handleStartTimeChange}
						placeholder="09:00"
						help={__(
							'Start time in HH:MM format (24-hour)',
							'fair-timetable'
						)}
						pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
					/>
					<SelectControl
						label={__('Length', 'fair-timetable')}
						value={currentCalculatedLength}
						options={lengthOptions}
						onChange={handleLengthChange}
						help={__('Duration of the time slot', 'fair-timetable')}
					/>
					<TextControl
						label={__('End Time', 'fair-timetable')}
						value={endTime}
						onChange={handleEndTimeChange}
						placeholder="10:00"
						help={__(
							'End time in HH:MM format. If before start time, assumes next day.',
							'fair-timetable'
						)}
						pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<h4 className="time-annotation">
					{startTime}-{endTime}
				</h4>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
