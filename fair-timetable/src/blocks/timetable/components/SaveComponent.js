/**
 * Save component for the Timetable Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Timetable Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const { verticalAlignment } = attributes;

	const blockProps = useBlockProps.save({
		className: `timetable-container ${verticalAlignment ? `is-vertically-aligned-${verticalAlignment}` : ''}`,
	});

	const innerBlocksProps = useInnerBlocksProps.save(blockProps);

	return <div {...innerBlocksProps} />;
}
