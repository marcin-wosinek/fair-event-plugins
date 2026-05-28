/**
 * Save component for the Time Slot Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Time Slot Block
 *
 * @param {Object} props - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent() {
	const blockProps = useBlockProps.save();

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'time-slot-content',
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
