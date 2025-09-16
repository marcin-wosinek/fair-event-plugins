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

// Import utilities
import { formatLengthLabel } from '@utils/lengths.js';
import { HourlyRange } from '@utils/hourly-range.js';

/**
 * Edit component for the Timetable Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const { startTime, endTime, hourHeight } = attributes;

	// Create HourlyRange object from attributes for later use
	const timetableRange = new HourlyRange({ startTime, endTime });

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

	// Function to calculate current length in hours from start/end times
	const calculateCurrentLength = (startTime, endTime) => {
		// Use HourlyRange for duration calculation (handles cross-midnight automatically)
		const range = new HourlyRange({ startTime, endTime });
		return range.getDuration();
	};

	// Generate base length options (4h to 16h)
	const baseLengthOptions = [];
	for (let i = 4; i <= 16; i++) {
		baseLengthOptions.push({
			label: __(`${i} hours`, 'fair-timetable'),
			value: i,
		});
	}

	// Calculate current length from start/end hours
	const currentCalculatedLength = timetableRange.getDuration();

	// Check if current length matches any base option
	const hasMatchingOption = baseLengthOptions.some(
		(option) => option.value === currentCalculatedLength
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
		// Use HourlyRange static method for consistent time arithmetic
		return HourlyRange.calculateEndTime(startTime, lengthHours);
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
						help={__(
							'Duration of the timetable in hours',
							'fair-timetable'
						)}
					/>
					<TextControl
						label={__('End Time', 'fair-timetable')}
						value={endTime}
						onChange={handleEndTimeChange}
						placeholder="17:00"
						help={__(
							'End time in HH:MM format. If before start time, assumes next day.',
							'fair-timetable'
						)}
						pattern="^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
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
