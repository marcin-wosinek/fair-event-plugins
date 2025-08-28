/**
 * Save component for the Time Column Body Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Time Column Body Block
 *
 * @param {Object} props - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent() {
	const blockProps = useBlockProps.save({
		className: 'time-column-body-container',
	});

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'time-column-body-content',
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
