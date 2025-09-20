/**
 * Edit component for the Time Column Body Block
 */

import {
	useBlockProps,
	useInnerBlocksProps,
	ButtonBlockAppender,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { createBlock } from '@wordpress/blocks';
import { TimeColumn } from '@models/TimeColumn.js';
import { formatTime } from '@utils/timeUtils.js';

/**
 * Edit component for the Time Column Body Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ context, clientId }) {
	const { insertBlock } = useDispatch('core/block-editor');

	// Get context from parent timetable and use as defaults
	const contextStartTime = context['fair-timetable/startTime'] || '09:00';
	const contextEndTime = context['fair-timetable/endTime'] || '17:00';

	// Get inner blocks (time slots) data
	const innerBlocks = useSelect(
		(select) => {
			return select('core/block-editor').getBlocks(clientId);
		},
		[clientId]
	);

	// Extract time slot data from inner blocks
	const timeSlots = innerBlocks
		.filter((block) => block.name === 'fair-timetable/time-slot')
		.map((block) => ({
			startTime: block.attributes.startTime,
			endTime: block.attributes.endTime,
			...block.attributes,
		}));

	// Initialize TimeColumn with effective time range and time slots
	const timeColumn = new TimeColumn(
		{
			startTime: contextStartTime,
			endTime: contextEndTime,
		},
		timeSlots
	);

	const blockProps = useBlockProps({
		className: 'time-column-body-container',
	});

	// Template for allowed inner blocks (only time-slot blocks)
	const allowedBlocks = ['fair-timetable/time-slot'];

	// Custom appender function that uses first available hour
	const customAppender = () => {
		console.log('Adding new time slot at first available hour');
		const firstAvailableHour = timeColumn.getFirstAvailableHour();

		const newBlock = createBlock('fair-timetable/time-slot', {
			startTime: formatTime(firstAvailableHour),
			endTime: formatTime(
				Math.min(
					timeColumn.getFirstAvailableHour() + 1,
					timeColumn.getEndHour()
				)
			),
		});

		insertBlock(newBlock, undefined, clientId);
	};

	// Initial template - only shows if no blocks exist
	const template =
		timeSlots.length === 0
			? [
					[
						'fair-timetable/time-slot',
						{
							startTime: formatTime(
								timeColumn.getFirstAvailableHour()
							),
							endTime: formatTime(
								Math.min(
									timeColumn.getFirstAvailableHour() + 1,
									timeColumn.getEndHour()
								)
							),
						},
					],
				]
			: [];

	// Check if there's enough time for another slot (at least 0.5h)
	const firstAvailableHour = timeColumn.getFirstAvailableHour();
	const columnEndHour = timeColumn.getEndHour();
	const remainingTime = columnEndHour - firstAvailableHour;
	const hasSpaceForNewSlot = remainingTime >= 0.5;

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'time-column-body-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
			renderAppender: hasSpaceForNewSlot
				? () => (
						<ButtonBlockAppender
							rootClientId={clientId}
							onSelect={customAppender}
							className="block-list-appender__toggle"
						/>
					)
				: false,
		}
	);

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
