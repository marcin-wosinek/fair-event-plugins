/**
 * Save component for the Timetable Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Timetable Block
 *
 * @return {JSX.Element} The save component
 */
export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'timetable-container',
	});

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'timetable-content',
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
