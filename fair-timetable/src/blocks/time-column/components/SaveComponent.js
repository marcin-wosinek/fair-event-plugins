/**
 * Save component for the Time Column Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Time Column Block
 *
 * @return {JSX.Element} The save component
 */
export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'time-column-container',
	});

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'time-column-content',
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
