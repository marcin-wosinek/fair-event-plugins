/**
 * Save component for the Time Slot
 */

import { useBlockProps, RichText } from '@wordpress/block-editor';
import { differenceInMinutes, parse } from 'date-fns';

/**
 * Save component for the Time Slot
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @param {Object} props.context    - Block context from parent
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes, context }) {
	const { title, startHour, endHour } = attributes;
	const hourHeight = context?.['fair-timetable/hourHeight'] || 2.5; // Default to medium

	// Calculate block height based on duration
	const calculateBlockHeight = () => {
		if (!startHour || !endHour) return `${hourHeight}em`; // Default 1 hour

		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		const durationInMinutes = differenceInMinutes(endDate, startDate);
		const durationInHours = durationInMinutes / 60;

		return `${durationInHours * hourHeight}em`;
	};

	const blockProps = useBlockProps.save({
		className: 'time-slot-block',
		style: {
			height: calculateBlockHeight(),
		},
	});

	return (
		<div {...blockProps}>
			<div className="time-slot">
				<span className="time-range">
					{startHour} - {endHour}
				</span>
				{title && (
					<h5 className="event-title">
						<RichText.Content value={title} />
					</h5>
				)}
			</div>
		</div>
	);
}
