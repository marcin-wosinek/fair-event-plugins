/**
 * Block deprecations for the Time Slot Block
 */

import { useBlockProps, RichText } from '@wordpress/block-editor';
import { differenceInMinutes, parse } from 'date-fns';

/**
 * Version 0.2.0 deprecation
 * - Had title, startHour, endHour attributes
 * - Used RichText for title display
 * - Had complex height calculations based on duration
 * - Used context for hourHeight
 * - Had fixed HTML structure with time range and title
 */
const v1 = {
	attributes: {
		title: {
			type: 'string',
			source: 'html',
			selector: '.event-title',
		},
		startHour: {
			type: 'string',
			default: '09:00',
		},
		endHour: {
			type: 'string',
			default: '10:00',
		},
		startTime: {
			type: 'string',
			default: '09:00',
		},
		endTime: {
			type: 'string',
			default: '10:00',
		},
	},

	migrate(attributes) {
		// Convert old attributes to new format
		const { title, startHour, endHour, ...otherAttributes } = attributes;

		// Map old attributes to new ones, keeping startTime/endTime
		return {
			...otherAttributes,
			startTime: startHour || attributes.startTime || '09:00',
			endTime: endHour || attributes.endTime || '10:00',
			// title is no longer used in the new version
		};
	},

	save: ({ attributes, context }) => {
		const { title, startHour, endHour } = attributes;
		const hourHeight = context?.['fair-timetable/hourHeight'] || 2.5;

		// Calculate block height based on duration
		const calculateBlockHeight = () => {
			if (!startHour || !endHour) return `${hourHeight}em`;

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
	},
};

export default [v1];