/**
 * Save component for the Simple Payment Block
 */

import { useBlockProps, useInnerBlocksProps } from '@wordpress/block-editor';

/**
 * Save component for the Simple Payment Block
 *
 * @param {Object} props            - Block props
 * @param {Object} props.attributes - Block attributes
 * @return {JSX.Element} The save component
 */
export default function SaveComponent({ attributes }) {
	const blockProps = useBlockProps.save({
		className: 'simple-payment-block',
	});

	const { amount, currency } = attributes;

	const innerBlocksProps = useInnerBlocksProps.save({
		className: 'simple-payment-button-wrapper',
		'data-amount': amount,
		'data-currency': currency,
	});

	return (
		<div {...blockProps}>
			<div {...innerBlocksProps} />
		</div>
	);
}
