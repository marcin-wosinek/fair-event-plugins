/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect } from '@wordpress/element';

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
		const { blockId, amount, currency, description } = attributes;

		useEffect(() => {
			if (!blockId) {
				setAttributes({ blockId: crypto.randomUUID() });
			}
		}, []);

		return (
			<div {...blockProps}>
				<div className="fair-payments-connector-block">
					<h3>
						{__('Simple Payment Block', 'fair-payments-connector')}
					</h3>
					<TextControl
						label={__('Amount', 'fair-payments-connector')}
						value={amount}
						onChange={(value) => setAttributes({ amount: value })}
						type="number"
						min="0"
						step="0.01"
					/>
					<TextControl
						label={__('Currency', 'fair-payments-connector')}
						value={currency}
						onChange={(value) => setAttributes({ currency: value })}
					/>
					<TextControl
						label={__(
							'Description (optional)',
							'fair-payments-connector'
						)}
						value={description}
						onChange={(value) =>
							setAttributes({ description: value })
						}
						help={__(
							'Optional description for the payment',
							'fair-payments-connector'
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
							{__('Pay Now', 'fair-payments-connector')}
						</button>
					</div>
				</div>
			</div>
		);
	},
});
