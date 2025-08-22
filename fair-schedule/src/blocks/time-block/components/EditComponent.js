/**
 * Edit component for the Time Block
 */

import { TextControl, PanelBody } from '@wordpress/components';
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
 * Edit component for the Time Block
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
	const hourHeight = context['fair-schedule/hourHeight'] || 2.5; // Default to medium

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
					(block) => block.name === 'fair-schedule/time-block'
				),
			};
		},
		[clientId]
	);

	// Calculate current duration in minutes
	const getCurrentDuration = () => {
		if (!startHour || !endHour) return 60; // Default 1 hour in minutes

		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		return differenceInMinutes(endDate, startDate);
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
		const columnStartHour = context['fair-schedule/startHour'];

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

	// Find correct position for time-block based on start time
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

	const blockProps = useBlockProps({
		className: 'time-block',
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
				<PanelBody title={__('Time Block Settings', 'fair-schedule')}>
					<TextControl
						label={__('Start Hour', 'fair-schedule')}
						value={startHour}
						onChange={handleStartHourChange}
						type="time"
					/>
					<TextControl
						label={__('End Hour', 'fair-schedule')}
						value={endHour}
						onChange={(value) => setAttributes({ endHour: value })}
						type="time"
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
						placeholder={__('Event title', 'fair-schedule')}
					/>
				</div>
			</div>
		</>
	);
}
