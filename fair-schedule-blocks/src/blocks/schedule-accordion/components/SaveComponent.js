/**
 * Save component for the Schedule Accordion Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Schedule Accordion Block
 *
 * @return {JSX.Element} The save component
 */
export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'schedule-accordion-container',
	});

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'schedule-accordion-content',
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
