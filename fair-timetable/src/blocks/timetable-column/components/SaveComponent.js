/**
 * Save component for the Timetable Column Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';
import { parse, differenceInHours } from 'date-fns';

/**
 * Save component for the Timetable Column Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'timetable-column',
	});

	const { columnTitle, columnType, startHour, endHour, hourHeight } =
		attributes;

	// Calculate the height of the schedule column content area
	const getContentHeight = () => {
		const startDate = parse(startHour, 'HH:mm', new Date());
		const endDate = parse(endHour, 'HH:mm', new Date());
		const hours = differenceInHours(endDate, startDate);
		return hours * hourHeight;
	};

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'timetable-column-content',
		style: {
			height: `${getContentHeight()}em`,
		},
	});

	return (
		<div
			{...blockProps}
			data-start-hour={startHour}
			data-end-hour={endHour}
			data-hour-height={hourHeight}
		>
			{columnTitle && (
				<div className="timetable-column-header">
					<h3 className="timetable-column-title">{columnTitle}</h3>
					<span
						className="timetable-column-type"
						data-type={columnType}
					>
						{columnType}
					</span>
				</div>
			)}
			<div {...innerBlocksProps} />
		</div>
	);
}
