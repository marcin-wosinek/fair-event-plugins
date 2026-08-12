/**
 * Save component for the Calendar Button Block
 */
import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Save component for the Calendar Button Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save();

	// Add wp-block-buttons class to support button width settings
	const innerBlocksProps = useInnerBlocksProps.save({
		...blockProps,
		className: `${blockProps.className || ''} wp-block-buttons`.trim(),
	});

	return <div {...innerBlocksProps} />;
}
