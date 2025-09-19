/**
 * Edit component for the Timetable Block
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
import { HourlyRange } from '@models/HourlyRange.js';

/**
 * Edit component for the Timetable Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, clientId }) {
	const { startTime, endTime, hourHeight } = attributes;

	// Store HourlyRange instance between renders to handle invalid intermediate values
	const timetableRangeRef = useRef(null);

	// Create or update HourlyRange object, falling back to previous valid instance if needed
	try {
		if (startTime && endTime) {
			timetableRangeRef.current = new HourlyRange({ startTime, endTime });
		}
	} catch (error) {
		// Keep previous valid instance if new values are invalid
	}

	// Fallback to default if no valid instance exists
	if (!timetableRangeRef.current) {
		timetableRangeRef.current = new HourlyRange({
			startTime: '09:00',
			endTime: '17:00',
		});
	}

	const timetableRange = timetableRangeRef.current;

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
			const canonicalStartTime = timetableRange.getStartTime();
			const canonicalEndTime = timetableRange.getEndTime();

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
	}, [isSelected, startTime, endTime, timetableRange, setAttributes]);

	const blockProps = useBlockProps({
		className: 'timetable-container',
	});

	// Calculate column height based on time range and hour height
	const getColumnHeight = () => {
		// Use HourlyRange for duration calculation (handles cross-midnight automatically)
		const hours = timetableRange.getDuration();
		return hours * hourHeight;
	};

	// Generate hour height options
	const hourHeightOptions = [];
	for (let i = 2; i <= 8; i++) {
		hourHeightOptions.push({
			label: i.toString(),
			value: i,
		});
	}

	// Generate length options (4h to 16h) with current duration
	const baseLengthValues = [];
	for (let i = 4; i <= 16; i++) {
		baseLengthValues.push(i);
	}
	const lengthOptionsGenerator = new LengthOptions(baseLengthValues);

	// Calculate current length from start/end hours
	const currentCalculatedLength = timetableRange.getDuration();

	// Set current value (handles rounding and custom values automatically)
	lengthOptionsGenerator.setValue(currentCalculatedLength);

	// Get all options including custom value if needed
	const lengthOptions = lengthOptionsGenerator.getLengthOptions();

	// Handle start time change while maintaining constant length
	const handleStartTimeChange = (newStartTime) => {
		timetableRange.setStartTime(newStartTime);
		setAttributes({
			startTime: newStartTime,
			endTime: timetableRange.getEndTime(),
		});
	};

	// Handle length change while keeping start time constant
	const handleLengthChange = (newLength) => {
		timetableRange.setDuration(parseFloat(newLength));
		setAttributes({
			endTime: timetableRange.getEndTime(),
		});
	};

	// Handle end time change and recalculate length
	const handleEndTimeChange = (newEndTime) => {
		timetableRange.setEndTime(newEndTime);
		setAttributes({
			endTime: newEndTime,
		});
	};

	// Template for allowed inner blocks
	const allowedBlocks = ['fair-timetable/time-column'];

	// Default template with 3 time columns
	const template = [
		['fair-timetable/time-column'],
		['fair-timetable/time-column'],
		['fair-timetable/time-column'],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'timetable-content',
			style: {
				'--hour-height': hourHeight,
				'--column-height': `${getColumnHeight()}em`,
				'--column-length': currentCalculatedLength,
				minHeight: `${getColumnHeight()}em`,
			},
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
				<PanelBody title={__('Timetable Settings', 'fair-timetable')}>
					<TextControl
						label={__('Start Time', 'fair-timetable')}
						value={startTime}
						onChange={handleStartTimeChange}
						onBlur={() => {
							const canonicalStartTime =
								timetableRange.getStartTime();
							if (canonicalStartTime !== startTime) {
								setAttributes({
									startTime: canonicalStartTime,
								});
							}
						}}
						placeholder={timetableRange.getStartTime()}
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
						help={__(
							'Duration of the timetable in hours',
							'fair-timetable'
						)}
					/>
					<TextControl
						label={__('End Time', 'fair-timetable')}
						value={endTime}
						onChange={handleEndTimeChange}
						onBlur={() => {
							const canonicalEndTime =
								timetableRange.getEndTime();
							if (canonicalEndTime !== endTime) {
								setAttributes({ endTime: canonicalEndTime });
							}
						}}
						placeholder={timetableRange.getEndTime()}
						help={__(
							'End time in HH:MM format. If before start time, assumes next day.',
							'fair-timetable'
						)}
					/>
					<SelectControl
						label={__('Hour Height', 'fair-timetable')}
						value={hourHeight}
						options={hourHeightOptions}
						onChange={(value) =>
							setAttributes({ hourHeight: parseInt(value) })
						}
						help={__(
							'Visual height multiplier for each hour (2-8)',
							'fair-timetable'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
