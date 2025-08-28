/**
 * Edit component for the Time Slot
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	RichText,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { differenceInMinutes, parse, addMinutes, format } from 'date-fns';

/**
 * Edit component for the Time Slot
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({
	attributes,
	setAttributes,
	context,
	clientId,
}) {
	const { title, startHour, endHour } = attributes;
	const hourHeight = context['fair-timetable/hourHeight'] || 2.5; // Default to medium

	const { moveBlocksToPosition } = useDispatch(blockEditorStore);

	// Get parent block and sibling blocks for reordering
	const { parentClientId, siblingBlocks } = useSelect(
		(select) => {
			const parentId =
				select(blockEditorStore).getBlockParents(clientId)[0];
			const siblings = parentId
				? select(blockEditorStore).getBlocks(parentId)
				: [];
			return {
				parentClientId: parentId,
				siblingBlocks: siblings.filter(
					(block) => block.name === 'fair-timetable/time-slot'
				),
			};
		},
		[clientId]
	);

	// Duration options (in minutes)
	const durationOptions = [
		{ label: __('30 minutes', 'fair-timetable'), value: 30 },
		{ label: __('45 minutes', 'fair-timetable'), value: 45 },
		{ label: __('1 hour', 'fair-timetable'), value: 60 },
		{ label: __('1.5 hours', 'fair-timetable'), value: 90 },
		{ label: __('2 hours', 'fair-timetable'), value: 120 },
		{ label: __('3 hours', 'fair-timetable'), value: 180 },
		{ label: __('4 hours', 'fair-timetable'), value: 240 },
		{ label: __('Custom', 'fair-timetable'), value: 'custom' },
	];

	// Calculate current duration in minutes
	const getCurrentDuration = () => {
		if (!startHour || !endHour) return 60; // Default 1 hour in minutes

		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		return differenceInMinutes(endDate, startDate);
	};

	// Get selected duration option or 'custom'
	const getSelectedDuration = () => {
		const currentDuration = getCurrentDuration();
		const matchingOption = durationOptions.find(
			(option) => option.value === currentDuration
		);
		return matchingOption ? currentDuration : 'custom';
	};

	// Calculate block height based on duration
	const calculateBlockHeight = () => {
		if (!startHour || !endHour) return `${hourHeight}em`; // Default 1 hour

		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		const durationInMinutes = differenceInMinutes(endDate, startDate);
		const durationInHours = durationInMinutes / 60;

		return `${durationInHours * hourHeight}em`;
	};

	// Calculate top position based on hour offset from column start
	const calculateTopPosition = () => {
		const columnStartHour = context['fair-timetable/startHour'];

		if (!startHour || !columnStartHour) return '0em';

		const columnStartDate = parse(columnStartHour, 'HH:mm', new Date());
		const blockStartDate = parse(startHour, 'HH:mm', new Date());
		const offsetInMinutes = differenceInMinutes(
			blockStartDate,
			columnStartDate
		);
		const offsetInHours = offsetInMinutes / 60;

		return `${offsetInHours * hourHeight}em`;
	};

	// Find correct position for time-slot based on start time
	const findCorrectPosition = (newStartHour) => {
		const newStartTime = parse(newStartHour, 'HH:mm', new Date());

		// Find where this block should be positioned chronologically
		let targetPosition = 0;
		for (let i = 0; i < siblingBlocks.length; i++) {
			const sibling = siblingBlocks[i];
			if (sibling.clientId === clientId) continue; // Skip current block

			if (sibling.attributes.startHour) {
				const siblingStartTime = parse(
					sibling.attributes.startHour,
					'HH:mm',
					new Date()
				);
				if (newStartTime > siblingStartTime) {
					targetPosition++;
				}
			}
		}

		return targetPosition;
	};

	// Handle start hour change while maintaining duration and reordering
	const handleStartHourChange = (newStartHour) => {
		if (!newStartHour) {
			setAttributes({ startHour: newStartHour });
			return;
		}

		const currentDuration = getCurrentDuration();
		const newStartDate = parse(newStartHour, 'HH:mm', new Date());
		const newEndDate = addMinutes(newStartDate, currentDuration);
		const newEndHour = format(newEndDate, 'HH:mm');

		// Update attributes first
		setAttributes({
			startHour: newStartHour,
			endHour: newEndHour,
		});

		// Find the correct chronological position and move if needed
		if (parentClientId && siblingBlocks.length > 1) {
			const currentPosition = siblingBlocks.findIndex(
				(block) => block.clientId === clientId
			);
			const targetPosition = findCorrectPosition(newStartHour);

			if (currentPosition !== targetPosition) {
				// Move block to correct chronological position
				moveBlocksToPosition(
					[clientId],
					parentClientId,
					parentClientId,
					targetPosition
				);
			}
		}
	};

	// Handle end hour change - updates duration based on time difference
	const handleEndHourChange = (newEndHour) => {
		setAttributes({ endHour: newEndHour });
	};

	// Handle duration selection change
	const handleDurationChange = (selectedDuration) => {
		if (selectedDuration === 'custom' || !startHour) return;

		const startDate = parse(startHour, 'HH:mm', new Date());
		const newEndDate = addMinutes(startDate, selectedDuration);
		const newEndHour = format(newEndDate, 'HH:mm');

		setAttributes({ endHour: newEndHour });
	};

	const blockProps = useBlockProps({
		className: 'time-slot-block',
		style: {
			position: 'absolute',
			top: calculateTopPosition(),
			left: '0',
			right: '0',
			height: calculateBlockHeight(),
		},
	});

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Time Block Settings', 'fair-timetable')}>
					<TextControl
						label={__('Start Hour', 'fair-timetable')}
						value={startHour}
						onChange={handleStartHourChange}
						type="time"
						help={__(
							'Changing start time maintains duration',
							'fair-timetable'
						)}
					/>
					<SelectControl
						label={__('Duration', 'fair-timetable')}
						value={getSelectedDuration()}
						options={durationOptions}
						onChange={handleDurationChange}
						help={__(
							'Select preset duration or use custom end time',
							'fair-timetable'
						)}
					/>
					<TextControl
						label={__('End Hour', 'fair-timetable')}
						value={endHour}
						onChange={handleEndHourChange}
						type="time"
						help={__(
							'Manual end time (sets duration to Custom)',
							'fair-timetable'
						)}
					/>
				</PanelBody>
			</InspectorControls>
			<div {...blockProps}>
				<div className="time-slot">
					<span className="time-range">
						{startHour} - {endHour}
					</span>
					<RichText
						tagName="h5"
						className="event-title"
						value={title}
						onChange={(value) => setAttributes({ title: value })}
						placeholder={__('Event title', 'fair-timetable')}
					/>
				</div>
			</div>
		</>
	);
}
