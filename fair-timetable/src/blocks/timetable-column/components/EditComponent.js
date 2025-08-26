/**
 * Edit component for the Timetable Column Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import {
	addHours,
	addMinutes,
	format,
	parse,
	differenceInHours,
	differenceInMinutes,
} from 'date-fns';
import { useEffect, useRef } from '@wordpress/element';
import { store as noticesStore } from '@wordpress/notices';

/**
 * Edit component for the Timetable Column Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, clientId }) {
	const blockProps = useBlockProps({
		className: 'timetable-column',
	});

	const { columnTitle, columnType, startHour, endHour, hourHeight } =
		attributes;

	// Get inner blocks to calculate next start time
	const innerBlocks = useSelect(
		(select) => {
			return select(blockEditorStore).getBlocks(clientId);
		},
		[clientId]
	);

	const { updateBlockAttributes, moveBlocksToPosition } =
		useDispatch(blockEditorStore);
	const { createNotice } = useDispatch(noticesStore);

	// Keep track of previous block order for reordering detection
	const previousBlockOrderRef = useRef([]);

	// Calculate the next start time based on the last time-slot's end time
	const getNextStartTime = () => {
		if (innerBlocks.length === 0) {
			return '09:00'; // Default start time for first block
		}

		const lastBlock = innerBlocks[innerBlocks.length - 1];
		if (
			lastBlock.name === 'fair-timetable/time-slot' &&
			lastBlock.attributes.endHour
		) {
			return lastBlock.attributes.endHour;
		}

		return '09:00';
	};

	// Calculate end time (1 hour after start time) using date-fns
	const getNextEndTime = () => {
		const startTime = getNextStartTime();
		const startDate = parse(startTime, 'HH:mm', new Date());
		const endDate = addHours(startDate, 1);
		return format(endDate, 'HH:mm');
	};

	// Calculate the height of the schedule column content area
	const getContentHeight = () => {
		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		const hours = differenceInHours(endDate, startDate);
		return hours * hourHeight;
	};

	// Calculate duration of a time block in minutes
	const getBlockDuration = (block) => {
		if (!block.attributes.startHour || !block.attributes.endHour) return 60;
		const startDate = parse(
			block.attributes.startHour,
			'HH:mm',
			new Date()
		);
		const endDate = parse(block.attributes.endHour, 'HH:mm', new Date());
		return differenceInMinutes(endDate, startDate);
	};

	// Update block times when dropped in new position
	const updateBlockTimes = (movedBlockId, newPosition, oldPosition) => {
		const timeBlocks = innerBlocks.filter(
			(block) => block.name === 'fair-timetable/time-slot'
		);
		const movedBlock = timeBlocks.find(
			(block) => block.clientId === movedBlockId
		);

		if (!movedBlock) return;

		const originalDuration = getBlockDuration(movedBlock);
		const MINIMUM_DURATION = 15; // minutes

		// Calculate available time slot based on new position
		let availableStart, availableEnd;

		// Get the current block order (after the move)
		const currentTimeBlocks = timeBlocks.slice(); // copy array

		if (newPosition === 0) {
			// First position - use column start
			availableStart = startHour;
			availableEnd =
				currentTimeBlocks.length > 1 && currentTimeBlocks[1]
					? currentTimeBlocks[1].attributes.startHour
					: endHour;
		} else if (newPosition === currentTimeBlocks.length - 1) {
			// Last position - use column end
			availableStart =
				currentTimeBlocks[newPosition - 1].attributes.endHour ||
				startHour;
			availableEnd = endHour;

			// Additional check: ensure block doesn't exceed column end time
			const proposedStartDate = parse(
				availableStart,
				'HH:mm',
				new Date()
			);
			const proposedEndDate = addMinutes(
				proposedStartDate,
				originalDuration
			);
			const columnEndDate = parse(endHour, 'HH:mm', new Date());

			if (proposedEndDate > columnEndDate) {
				// Block would exceed column end - adjust to fit within column
				const maxDuration = differenceInMinutes(
					columnEndDate,
					proposedStartDate
				);
				if (maxDuration < MINIMUM_DURATION) {
					createNotice(
						'error',
						`Cannot fit time block in last position! Available: ${maxDuration} minutes, Required: ${MINIMUM_DURATION} minutes`,
						{
							isDismissible: true,
							type: 'snackbar',
						}
					);
					// Revert block to original position
					moveBlocksToPosition(
						[movedBlockId],
						clientId,
						clientId,
						oldPosition
					);
					return;
				}
			}
		} else {
			// Middle position - between two blocks
			availableStart =
				currentTimeBlocks[newPosition - 1].attributes.endHour ||
				startHour;
			availableEnd =
				currentTimeBlocks[newPosition + 1].attributes.startHour ||
				endHour;
		}

		// Parse times to calculate available slot duration
		const availableStartDate = parse(availableStart, 'HH:mm', new Date());
		const availableEndDate = parse(availableEnd, 'HH:mm', new Date());
		const availableSlotDuration = differenceInMinutes(
			availableEndDate,
			availableStartDate
		);

		let newStartTime, newEndTime, finalDuration;

		if (originalDuration <= availableSlotDuration) {
			// Block fits with original duration - don't extend to fill space
			newStartTime = availableStart;
			finalDuration = originalDuration;
		} else {
			// Block doesn't fit - squeeze to available space, minimum 15 minutes
			finalDuration = Math.max(availableSlotDuration, MINIMUM_DURATION);

			if (finalDuration <= availableSlotDuration) {
				// Fits with squeezed duration
				newStartTime = availableStart;
			} else {
				// Even minimum doesn't fit - show notice and revert position
				createNotice(
					'error',
					`Cannot fit time block in available slot! Available: ${availableSlotDuration} minutes, Required: ${MINIMUM_DURATION} minutes`,
					{
						isDismissible: true,
						type: 'snackbar',
					}
				);
				// Revert block to original position
				moveBlocksToPosition(
					[movedBlockId],
					clientId,
					clientId,
					oldPosition
				);
				return;
			}
		}

		// Calculate new end time
		const newStartDate = parse(newStartTime, 'HH:mm', new Date());
		const newEndDate = addMinutes(newStartDate, finalDuration);
		newEndTime = format(newEndDate, 'HH:mm');

		// Update the block attributes
		updateBlockAttributes(movedBlockId, {
			startHour: newStartTime,
			endHour: newEndTime,
		});
	};

	// Simple alert when time-slot is dropped/reordered
	useEffect(() => {
		const currentBlockOrder = innerBlocks
			.filter((block) => block.name === 'fair-timetable/time-slot')
			.map((block) => block.clientId);

		const previousOrder = previousBlockOrderRef.current;

		if (
			previousOrder.length > 0 &&
			currentBlockOrder.length === previousOrder.length
		) {
			// Check if order changed
			const orderChanged = !currentBlockOrder.every(
				(id, index) => id === previousOrder[index]
			);

			if (orderChanged) {
				// Find which block actually moved by comparing arrays more carefully
				let movedBlockId = null;
				let newPosition = -1;
				let oldPosition = -1;

				// Find blocks that are in different positions
				for (let i = 0; i < currentBlockOrder.length; i++) {
					const blockId = currentBlockOrder[i];
					const previousIndex = previousOrder.indexOf(blockId);

					// If this block moved to a new position
					if (previousIndex !== i) {
						// Check if this is likely the dragged block (moved the furthest)
						const distance = Math.abs(previousIndex - i);
						if (
							movedBlockId === null ||
							distance > Math.abs(oldPosition - newPosition)
						) {
							movedBlockId = blockId;
							newPosition = i;
							oldPosition = previousIndex;
						}
					}
				}

				if (movedBlockId) {
					// Update the block times based on new position
					updateBlockTimes(movedBlockId, newPosition, oldPosition);
				}
			}
		}

		previousBlockOrderRef.current = currentBlockOrder;
	}, [innerBlocks]);

	// Template for allowed inner blocks
	const allowedBlocks = ['fair-timetable/time-slot'];

	// Default template with a sample time block
	const template = [
		[
			'fair-timetable/time-slot',
			{
				title: 'Sample Event',
				startHour: '09:00',
				endHour: '10:00',
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'timetable-column-content',
			style: {
				height: `${getContentHeight()}em`,
			},
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
			__experimentalDefaultBlock: {
				name: 'fair-timetable/time-slot',
				attributes: {
					title: 'New Event',
					startHour: getNextStartTime(),
					endHour: getNextEndTime(),
				},
			},
			__experimentalDirectInsert: true,
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Column Settings', 'fair-timetable')}>
					<TextControl
						label={__('Column Title', 'fair-timetable')}
						value={columnTitle}
						onChange={(value) =>
							setAttributes({ columnTitle: value })
						}
						placeholder={__(
							'e.g. Main Stage, Day 1, Room A',
							'fair-timetable'
						)}
					/>
					<SelectControl
						label={__('Column Type', 'fair-timetable')}
						value={columnType}
						options={[
							{
								label: __('Day', 'fair-timetable'),
								value: 'day',
							},
							{
								label: __('Place', 'fair-timetable'),
								value: 'place',
							},
						]}
						onChange={(value) =>
							setAttributes({ columnType: value })
						}
						help={__(
							'Choose how this column represents your schedule organization',
							'fair-timetable'
						)}
					/>
				</PanelBody>
				<PanelBody title={__('Time Settings', 'fair-timetable')}>
					<TextControl
						label={__('Start Hour', 'fair-timetable')}
						value={startHour}
						onChange={(value) =>
							setAttributes({ startHour: value })
						}
						placeholder="09:00"
						help={__(
							'Column start time in HH:MM format',
							'fair-timetable'
						)}
					/>
					<TextControl
						label={__('End Hour', 'fair-timetable')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						placeholder="18:00"
						help={__(
							'Column end time in HH:MM format',
							'fair-timetable'
						)}
					/>
					<SelectControl
						label={__('Hour Height', 'fair-timetable')}
						value={hourHeight}
						options={[
							{
								label: __('Small', 'fair-timetable'),
								value: 1.5,
							},
							{
								label: __('Medium', 'fair-timetable'),
								value: 2.5,
							},
							{
								label: __('Big', 'fair-timetable'),
								value: 3.5,
							},
						]}
						onChange={(value) =>
							setAttributes({ hourHeight: parseFloat(value) })
						}
						help={__(
							'Visual height multiplier for each hour in the schedule',
							'fair-timetable'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div className="timetable-column-header">
					{columnTitle ? (
						<h3 className="timetable-column-title">
							{columnTitle}
						</h3>
					) : (
						<h3 className="timetable-column-title placeholder">
							{__('Column Title', 'fair-timetable')}
						</h3>
					)}
				</div>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
