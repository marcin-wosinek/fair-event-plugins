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
