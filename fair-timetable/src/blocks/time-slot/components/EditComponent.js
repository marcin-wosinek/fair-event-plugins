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
import { useRef } from '@wordpress/element';

// Import utilities
import { LengthOptions } from '@models/LengthOptions.js';
import { TimeSlot } from '@models/TimeSlot.js';

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

	// Store TimeSlot instance between renders to handle invalid intermediate values
	const timeSlotRef = useRef(null);

	// Create or update TimeSlot object, falling back to previous valid instance if needed
	try {
		if (startTime && endTime) {
			timeSlotRef.current = new TimeSlot(
				{ startTime, endTime },
				timetableStartTime
			);
		}
	} catch (error) {
		// Keep previous valid instance if new values are invalid
	}

	// Fallback to default if no valid instance exists
	if (!timeSlotRef.current) {
		timeSlotRef.current = new TimeSlot(
			{ startTime: '09:00', endTime: '10:00' },
			timetableStartTime || '09:00'
		);
	}

	const timeSlot = timeSlotRef.current;

	// Calculate time from timetable start using TimeSlot class
	const timeSlotTimeFromStart = timeSlot.getTimeFromTimetableStart();

	const blockProps = useBlockProps({
		className: 'time-slot-container',
		style: {
			'--time-slot-length': timeSlot.getDuration(),
			'--time-slot-time-from-start': timeSlotTimeFromStart,
		},
	});

	// Generate length options (0.5h to 4h) with current duration
	const baseLengthValues = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
	const lengthOptionsGenerator = new LengthOptions(baseLengthValues);

	// Calculate current length from start/end times
	const currentCalculatedLength = timeSlot.getDuration();

	// Set current value (handles rounding and custom values automatically)
	lengthOptionsGenerator.setValue(currentCalculatedLength);

	// Get all options including custom value if needed
	const lengthOptions = lengthOptionsGenerator.getLengthOptions();

	// Handle start time change while maintaining constant length
	const handleStartTimeChange = (newStartTime) => {
		timeSlot.setStartTime(newStartTime);
		setAttributes({
			startTime: newStartTime,
			endTime: timeSlot.getEndTime(),
		});
	};

	// Handle length change while keeping start time constant
	const handleLengthChange = (newLength) => {
		timeSlot.setDuration(parseFloat(newLength));
		setAttributes({
			endTime: timeSlot.getEndTime(),
		});
	};

	// Handle end time change and recalculate length
	const handleEndTimeChange = (newEndTime) => {
		timeSlot.setEndTime(newEndTime);
		setAttributes({
			endTime: newEndTime,
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
