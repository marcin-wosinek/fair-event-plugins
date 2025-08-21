/**
 * Save component for the Schedule Column Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Schedule Column Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'schedule-column',
	});

	const { columnTitle, columnType, startHour, endHour, hourHeight } =
		attributes;

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'schedule-column-content',
	});

	return (
		<div
			{...blockProps}
			data-start-hour={startHour}
			data-end-hour={endHour}
			data-hour-height={hourHeight}
		>
			{columnTitle && (
				<div className="schedule-column-header">
					<h3 className="schedule-column-title">{columnTitle}</h3>
					<span
						className="schedule-column-type"
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
