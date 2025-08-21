/**
 * Edit component for the Schedule Column Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { addHours, format, parse, differenceInHours } from 'date-fns';
import { useEffect, useRef } from '@wordpress/element';

/**
 * Edit component for the Schedule Column Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {string}   props.clientId      - Block client ID
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, clientId }) {
	const blockProps = useBlockProps({
		className: 'schedule-column',
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

	// Keep track of previous block order for reordering detection
	const previousBlockOrderRef = useRef([]);

	// Calculate the next start time based on the last time-block's end time
	const getNextStartTime = () => {
		if (innerBlocks.length === 0) {
			return '09:00'; // Default start time for first block
		}

		const lastBlock = innerBlocks[innerBlocks.length - 1];
		if (
			lastBlock.name === 'fair-schedule/time-block' &&
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

	// Simple alert when time-block is dropped/reordered
	useEffect(() => {
		const currentBlockOrder = innerBlocks
			.filter((block) => block.name === 'fair-schedule/time-block')
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
					const movedBlock = innerBlocks.find(
						(block) => block.clientId === movedBlockId
					);

					if (movedBlock) {
						const blockData = {
							title:
								movedBlock.attributes.title || 'Untitled Event',
							startHour: movedBlock.attributes.startHour || 'N/A',
							endHour: movedBlock.attributes.endHour || 'N/A',
							oldPosition: oldPosition + 1,
							newPosition: newPosition + 1,
							totalBlocks: currentBlockOrder.length,
						};

						alert(
							`Time-block moved!\n\nTitle: ${blockData.title}\nTime: ${blockData.startHour} - ${blockData.endHour}\nMoved from position ${blockData.oldPosition} to ${blockData.newPosition} (of ${blockData.totalBlocks})`
						);
					}
				}
			}
		}

		previousBlockOrderRef.current = currentBlockOrder;
	}, [innerBlocks]);

	// Template for allowed inner blocks
	const allowedBlocks = ['fair-schedule/time-block'];

	// Default template with a sample time block
	const template = [
		[
			'fair-schedule/time-block',
			{
				title: 'Sample Event',
				startHour: '09:00',
				endHour: '10:00',
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'schedule-column-content',
			style: {
				height: `${getContentHeight()}em`,
			},
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
			__experimentalDefaultBlock: {
				name: 'fair-schedule/time-block',
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
				<PanelBody title={__('Column Settings', 'fair-schedule')}>
					<TextControl
						label={__('Column Title', 'fair-schedule')}
						value={columnTitle}
						onChange={(value) =>
							setAttributes({ columnTitle: value })
						}
						placeholder={__(
							'e.g. Main Stage, Day 1, Room A',
							'fair-schedule'
						)}
					/>
					<SelectControl
						label={__('Column Type', 'fair-schedule')}
						value={columnType}
						options={[
							{
								label: __('Day', 'fair-schedule'),
								value: 'day',
							},
							{
								label: __('Place', 'fair-schedule'),
								value: 'place',
							},
						]}
						onChange={(value) =>
							setAttributes({ columnType: value })
						}
						help={__(
							'Choose how this column represents your schedule organization',
							'fair-schedule'
						)}
					/>
				</PanelBody>
				<PanelBody title={__('Time Settings', 'fair-schedule')}>
					<TextControl
						label={__('Start Hour', 'fair-schedule')}
						value={startHour}
						onChange={(value) =>
							setAttributes({ startHour: value })
						}
						placeholder="09:00"
						help={__(
							'Column start time in HH:MM format',
							'fair-schedule'
						)}
					/>
					<TextControl
						label={__('End Hour', 'fair-schedule')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						placeholder="18:00"
						help={__(
							'Column end time in HH:MM format',
							'fair-schedule'
						)}
					/>
					<SelectControl
						label={__('Hour Height', 'fair-schedule')}
						value={hourHeight}
						options={[
							{
								label: __('Small', 'fair-schedule'),
								value: 1.5,
							},
							{
								label: __('Medium', 'fair-schedule'),
								value: 2.5,
							},
							{
								label: __('Big', 'fair-schedule'),
								value: 3.5,
							},
						]}
						onChange={(value) =>
							setAttributes({ hourHeight: parseFloat(value) })
						}
						help={__(
							'Visual height multiplier for each hour in the schedule',
							'fair-schedule'
						)}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div className="schedule-column-header">
					{columnTitle ? (
						<h3 className="schedule-column-title">{columnTitle}</h3>
					) : (
						<h3 className="schedule-column-title placeholder">
							{__('Column Title', 'fair-schedule')}
						</h3>
					)}
				</div>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
