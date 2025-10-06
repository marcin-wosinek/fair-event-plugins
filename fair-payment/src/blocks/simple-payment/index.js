/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

/**
 * Block metadata
 */
import metadata from './block.json';

/**
 * Register the Simple Payment block
 */
registerBlockType(metadata.name, {
	/**
	 * Edit component
	 *
	 * @param {Object}   props               - Block props
	 * @param {Object}   props.attributes    - Block attributes
	 * @param {Function} props.setAttributes - Function to set attributes
	 * @return {JSX.Element} The edit component
	 */
	edit: ({ attributes, setAttributes }) => {
		const blockProps = useBlockProps();
		const { amount, currency } = attributes;

		return (
			<div {...blockProps}>
				<div className="fair-payment-block">
					<h3>{__('Simple Payment Block', 'fair-payment')}</h3>
					<TextControl
						label={__('Amount', 'fair-payment')}
						value={amount}
						onChange={(value) => setAttributes({ amount: value })}
					/>
					<TextControl
						label={__('Currency', 'fair-payment')}
						value={currency}
						onChange={(value) => setAttributes({ currency: value })}
					/>
					<p>
						{__('Payment:', 'fair-payment')} {amount} {currency}
					</p>
				</div>
			</div>
		);
	},
});
