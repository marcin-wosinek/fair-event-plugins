/**
 * Save component for the Time Block
 */

import { useBlockProps, RichText } from '@wordpress/block-editor';

/**
 * Save component for the Time Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'time-block',
	});

	const { title, startHour, endHour } = attributes;

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
