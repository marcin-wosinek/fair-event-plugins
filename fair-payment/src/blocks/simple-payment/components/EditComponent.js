/**
 * Edit component for the Simple Payment Block
 */

import { TextControl, PanelBody, SelectControl } from '@wordpress/components';
import {
	useBlockProps,
	InspectorControls,
	useInnerBlocksProps,
} from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Edit component for the Simple Payment Block
 *
 * @param {Object}   props               - Block props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Function to set attributes
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ attributes, setAttributes }) {
	const blockProps = useBlockProps({
		className: 'simple-payment-block',
	});

	const { amount, currency } = attributes;

	const allowedTemplate = [
		[
			'core/button',
			{
				text: __('Pay Now', 'fair-payment'),
				className: 'simple-payment-button',
			},
		],
	];

	const innerBlocksProps = useInnerBlocksProps(
		{
			className: 'simple-payment-button-wrapper',
		},
		{
			template: allowedTemplate,
			templateLock: 'all',
		}
	);

	return (
		<>
			<InspectorControls>
				<PanelBody title={__('Payment Settings', 'fair-payment')}>
					<TextControl
						label={__('Amount', 'fair-payment')}
						value={amount}
						onChange={(value) => setAttributes({ amount: value })}
						type="number"
						min="0"
						step="0.01"
					/>
					<SelectControl
						label={__('Currency', 'fair-payment')}
						value={currency}
						options={
							window.fairPaymentAdmin?.allowedCurrencies || [
								{ label: 'USD ($)', value: 'USD' },
								{ label: 'EUR (€)', value: 'EUR' },
								{ label: 'GBP (£)', value: 'GBP' },
							]
						}
						onChange={(value) => setAttributes({ currency: value })}
					/>
				</PanelBody>
			</InspectorControls>

			<div {...blockProps}>
				<div {...innerBlocksProps} />
			</div>
		</>
	);
}
