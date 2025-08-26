/**
 * Edit component for the Timetable Column Block
 */

import {
	TextControl,
	PanelBody,
	SelectControl,
	Button,
	Notice,
} from '@wordpress/components';
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
export default function EditComponent({
	attributes,
	setAttributes,
	clientId,
	context,
}) {
	const blockProps = useBlockProps({
		className: 'timetable-column',
	});

	const { columnType, startHour, endHour, hourHeight } = attributes;

	// Get context from parent timetable (if any)
	const parentStartHour = context['fair-timetable/startHour'];
	const parentEndHour = context['fair-timetable/endHour'];
	const parentHourHeight = context['fair-timetable/hourHeight'];

	// Use parent context values if available, otherwise use own attributes
	const effectiveStartHour = parentStartHour || startHour;
	const effectiveEndHour = parentEndHour || endHour;
	const effectiveHourHeight = parentHourHeight || hourHeight;

	// Check if this column is inside a timetable block
	const isInsideTimetable = Boolean(parentStartHour);

	// Get inner blocks to calculate next start time and parent timetable info
	const { innerBlocks, parentClientId } = useSelect(
		(select) => {
			const parentBlocks =
				select(blockEditorStore).getBlockParents(clientId);
			const parentId = parentBlocks[0];
			return {
				innerBlocks: select(blockEditorStore).getBlocks(clientId),
				parentClientId: parentId,
			};
		},
		[clientId]
	);

	const { updateBlockAttributes, moveBlocksToPosition, selectBlock } =
		useDispatch(blockEditorStore);
	const { createNotice } = useDispatch(noticesStore);

	// Function to select parent timetable block
	const selectParentTimetable = () => {
		if (parentClientId) {
			selectBlock(parentClientId);
		}
	};

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
		const startDate = parse(effectiveStartHour, 'HH:mm', new Date());
		const endDate = parse(effectiveEndHour, 'HH:mm', new Date());
		const hours = differenceInHours(endDate, startDate);
		return hours * effectiveHourHeight;
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

	// API function to get time boundaries for drop position
	const getDropTimeBoundaries = (targetPosition, excludeBlockId = null) => {
		const timeBlocks = innerBlocks
			.filter((block) => block.name === 'fair-timetable/time-slot')
			.filter((block) => block.clientId !== excludeBlockId); // Exclude the dragged block

		const boundaries = {
			columnStartTime: effectiveStartHour,
			columnEndTime: effectiveEndHour,
			previousBlockEndTime: null,
			nextBlockStartTime: null,
			availableStartTime: null,
			availableEndTime: null,
		};

		// Get previous block (block before the drop position)
		if (targetPosition > 0 && timeBlocks[targetPosition - 1]) {
			boundaries.previousBlockEndTime =
				timeBlocks[targetPosition - 1].attributes.endHour;
			boundaries.availableStartTime = boundaries.previousBlockEndTime;
		} else {
			// First position - use column start
			boundaries.availableStartTime = effectiveStartHour;
		}

		// Get next block (block after the drop position)
		if (targetPosition < timeBlocks.length && timeBlocks[targetPosition]) {
			boundaries.nextBlockStartTime =
				timeBlocks[targetPosition].attributes.startHour;
			boundaries.availableEndTime = boundaries.nextBlockStartTime;
		} else {
			// Last position - use column end
			boundaries.availableEndTime = effectiveEndHour;
		}

		return boundaries;
	};

	// Helper function to validate if a block can be dropped at a position
	const canDropAtPosition = (
		targetPosition,
		blockDuration,
		excludeBlockId = null
	) => {
		const boundaries = getDropTimeBoundaries(
			targetPosition,
			excludeBlockId
		);
		const availableStartDate = parse(
			boundaries.availableStartTime,
			'HH:mm',
			new Date()
		);
		const availableEndDate = parse(
			boundaries.availableEndTime,
			'HH:mm',
			new Date()
		);
		const availableSlotDuration = differenceInMinutes(
			availableEndDate,
			availableStartDate
		);

		return {
			canFit: blockDuration <= availableSlotDuration,
			availableDuration: availableSlotDuration,
			boundaries,
		};
	};

	// Helper function to get all valid drop positions for a block
	const getValidDropPositions = (blockDuration, excludeBlockId = null) => {
		const timeBlocks = innerBlocks
			.filter((block) => block.name === 'fair-timetable/time-slot')
			.filter((block) => block.clientId !== excludeBlockId);

		const validPositions = [];

		// Check each possible position
		for (let i = 0; i <= timeBlocks.length; i++) {
			const validation = canDropAtPosition(
				i,
				blockDuration,
				excludeBlockId
			);
			if (validation.canFit) {
				validPositions.push({
					position: i,
					...validation,
				});
			}
		}

		return validPositions;
	};

	// Update block times when dropped in new position
	const updateBlockTimes = (movedBlockId, newPosition, oldPosition) => {
		const movedBlock = innerBlocks.find(
			(block) => block.clientId === movedBlockId
		);

		if (!movedBlock) return;

		const originalDuration = getBlockDuration(movedBlock);
		const MINIMUM_DURATION = 15; // minutes

		// Use the new API to get time boundaries
		const boundaries = getDropTimeBoundaries(newPosition, movedBlockId);
		const { availableStartTime, availableEndTime } = boundaries;

		// Example: Log the complete API data for debugging
		console.log('Drop Time Boundaries API:', {
			targetPosition: newPosition,
			draggedBlockId: movedBlockId,
			columnStartTime: boundaries.columnStartTime,
			columnEndTime: boundaries.columnEndTime,
			previousBlockEndTime: boundaries.previousBlockEndTime,
			nextBlockStartTime: boundaries.nextBlockStartTime,
			availableStartTime: boundaries.availableStartTime,
			availableEndTime: boundaries.availableEndTime,
		});

		// Parse times to calculate available slot duration
		const availableStartDate = parse(
			availableStartTime,
			'HH:mm',
			new Date()
		);
		const availableEndDate = parse(availableEndTime, 'HH:mm', new Date());
		const availableSlotDuration = differenceInMinutes(
			availableEndDate,
			availableStartDate
		);

		let newStartTime, newEndTime, finalDuration;

		if (originalDuration <= availableSlotDuration) {
			// Block fits with original duration - don't extend to fill space
			newStartTime = availableStartTime;
			finalDuration = originalDuration;
		} else {
			// Block doesn't fit - squeeze to available space, minimum 15 minutes
			finalDuration = Math.max(availableSlotDuration, MINIMUM_DURATION);

			if (finalDuration <= availableSlotDuration) {
				// Fits with squeezed duration
				newStartTime = availableStartTime;
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

				{isInsideTimetable ? (
					<PanelBody title={__('Time Settings', 'fair-timetable')}>
						<Notice status="info" isDismissible={false}>
							{__(
								'Time settings are controlled by the parent Timetable block.',
								'fair-timetable'
							)}
						</Notice>
						<p>
							<strong>
								{__('Start Hour:', 'fair-timetable')}
							</strong>{' '}
							{effectiveStartHour}
							<br />
							<strong>
								{__('End Hour:', 'fair-timetable')}
							</strong>{' '}
							{effectiveEndHour}
							<br />
							<strong>
								{__('Hour Height:', 'fair-timetable')}
							</strong>{' '}
							{effectiveHourHeight}em
						</p>
						<Button
							variant="secondary"
							onClick={selectParentTimetable}
							style={{ marginTop: '10px' }}
						>
							{__('Edit in Timetable', 'fair-timetable')}
						</Button>
					</PanelBody>
				) : (
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
							onChange={(value) =>
								setAttributes({ endHour: value })
							}
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
				)}
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
