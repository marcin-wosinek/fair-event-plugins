/**
 * Edit component for the Time Column Body Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { parse, differenceInHours, addDays, isAfter } from 'date-fns';

/**
 * Edit component for the Time Column Body Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @param {Object}   props.context       - Block context from parent
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes, context }) {
	const { startHour, endHour } = attributes;

	// Get context from parent timetable and use as defaults
	const contextStartHour = context['fair-timetable/startHour'] || '09:00';
	const contextEndHour = context['fair-timetable/endHour'] || '17:00';

	// Use context values if attributes are empty
	const effectiveStartHour = startHour || contextStartHour;

	// Set attributes to context values if they're empty
	if (!startHour || !endHour) {
		setAttributes({
			startHour: contextStartHour,
			endHour: contextEndHour,
		});
	}

	const blockProps = useBlockProps({
		className: 'time-column-body-container',
	});

	// Template for allowed inner blocks (only time-slot blocks)
	const allowedBlocks = ['fair-timetable/time-slot'];

	// Default template with a sample time slot
	const template = [
		[
			'fair-timetable/time-slot',
			{
				startHour: effectiveStartHour,
				endHour:
					parse(effectiveStartHour, 'HH:mm', new Date()).getHours() +
					1 +
					':00',
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'time-column-body-content',
		},
		{
			allowedBlocks,
			template,
			templateLock: false,
		}
	);

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
