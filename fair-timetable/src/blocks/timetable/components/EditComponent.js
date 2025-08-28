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
import {
	addHours,
	format,
	parse,
	differenceInHours,
	differenceInMinutes,
	addDays,
	isAfter,
	isSameDay,
	formatDuration,
	intervalToDuration,
} from 'date-fns';

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
	const { startHour, endHour, length, hourHeight } = attributes;

	const blockProps = useBlockProps({
		className: 'timetable-container',
	});

	// Calculate column height based on time range and hour height
	const getColumnHeight = () => {
		const startDate = parse(startHour, 'HH:mm', new Date());
		let endDate = parse(endHour, 'HH:mm', new Date());

		// If end time is before start time, assume next day
		if (!isAfter(endDate, startDate)) {
			endDate = addDays(endDate, 1);
		}

		const hours = differenceInHours(endDate, startDate);
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

	// Function to format duration for display
	const formatLengthLabel = (lengthInHours) => {
		const hours = Math.floor(lengthInHours);
		const minutes = Math.round((lengthInHours - hours) * 60);

		if (minutes === 0) {
			return __(`${hours} hours`, 'fair-timetable');
		} else {
			return __(`${hours} hours, ${minutes} minutes`, 'fair-timetable');
		}
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
	const currentCalculatedLength = calculateCurrentLength(startHour, endHour);

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
	const calculateEndHour = (startTime, lengthHours) => {
		const startDate = parse(startTime, 'HH:mm', new Date());
		const endDate = addHours(startDate, lengthHours);
		return format(endDate, 'HH:mm');
	};

	// Handle start hour change while maintaining constant length
	const handleStartHourChange = (newStartHour) => {
		const newEndHour = calculateEndHour(newStartHour, length);
		setAttributes({
			startHour: newStartHour,
			endHour: newEndHour,
		});
	};

	// Handle length change while keeping start hour constant
	const handleLengthChange = (newLength) => {
		const newEndHour = calculateEndHour(startHour, newLength);
		setAttributes({
			length: parseFloat(newLength),
			endHour: newEndHour,
		});
	};

	// Handle end hour change and recalculate length
	const handleEndHourChange = (newEndHour) => {
		const newLength = calculateCurrentLength(startHour, newEndHour);
		setAttributes({
			endHour: newEndHour,
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
						label={__('Start Hour', 'fair-timetable')}
						value={startHour}
						onChange={handleStartHourChange}
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
						label={__('End Hour', 'fair-timetable')}
						value={endHour}
						onChange={handleEndHourChange}
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
