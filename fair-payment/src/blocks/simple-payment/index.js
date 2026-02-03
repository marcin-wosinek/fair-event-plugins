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
		const { amount, currency, description } = attributes;

		return (
			<div {...blockProps}>
				<div className="fair-payment-block">
					<h3>{__('Simple Payment Block', 'fair-payment')}</h3>
					<TextControl
						label={__('Amount', 'fair-payment')}
						value={amount}
						onChange={(value) => setAttributes({ amount: value })}
						type="number"
						min="0"
						step="0.01"
					/>
					<TextControl
						label={__('Currency', 'fair-payment')}
						value={currency}
						onChange={(value) => setAttributes({ currency: value })}
					/>
					<TextControl
						label={__('Description (optional)', 'fair-payment')}
						value={description}
						onChange={(value) =>
							setAttributes({ description: value })
						}
						help={__(
							'Optional description for the payment',
							'fair-payment'
						)}
					/>
					<div
						style={{
							marginTop: '20px',
							padding: '15px',
							border: '1px solid #ddd',
							borderRadius: '4px',
							backgroundColor: '#f9f9f9',
						}}
					>
						<strong>
							{amount} {currency}
						</strong>
						{description && <p>{description}</p>}
						<button className="wp-element-button" disabled>
							{__('Pay Now', 'fair-payment')}
						</button>
					</div>
				</div>
			</div>
		);
	},
});
