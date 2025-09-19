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
import { useRef, useEffect } from '@wordpress/element';
import { useSelect } from '@wordpress/data';

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
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({
	attributes,
	setAttributes,
	context,
	clientId,
}) {
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

	// Monitor block selection state
	const isSelected = useSelect(
		(select) => {
			return select('core/block-editor').isBlockSelected(clientId);
		},
		[clientId]
	);

	const wasSelected = useRef(false);

	// Handle block losing focus
	useEffect(() => {
		if (wasSelected.current && !isSelected) {
			// Block lost focus - canonicalize all time values
			const canonicalStartTime = timeSlot.getStartTime();
			const canonicalEndTime = timeSlot.getEndTime();

			const updates = {};
			if (canonicalStartTime !== startTime) {
				updates.startTime = canonicalStartTime;
			}
			if (canonicalEndTime !== endTime) {
				updates.endTime = canonicalEndTime;
			}

			if (Object.keys(updates).length > 0) {
				setAttributes(updates);
			}
		}

		wasSelected.current = isSelected;
	}, [isSelected, startTime, endTime, timeSlot, setAttributes]);

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
						onBlur={() => {
							const canonicalStartTime = timeSlot.getStartTime();
							if (canonicalStartTime !== startTime) {
								setAttributes({
									startTime: canonicalStartTime,
								});
							}
						}}
						placeholder={timeSlot.getStartTime()}
						help={__(
							'Start time in HH:MM format (24-hour)',
							'fair-timetable'
						)}
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
						onBlur={() => {
							const canonicalEndTime = timeSlot.getEndTime();
							if (canonicalEndTime !== endTime) {
								setAttributes({ endTime: canonicalEndTime });
							}
						}}
						placeholder={timeSlot.getEndTime()}
						help={__(
							'End time in HH:MM format. If before start time, assumes next day.',
							'fair-timetable'
						)}
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
