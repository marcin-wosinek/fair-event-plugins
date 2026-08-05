/**
 * WordPress dependencies
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { select as dataSelect } from '@wordpress/data';
import { Notice, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { generateUuid } from 'fair-events-shared';

/**
 * Block metadata
 */
import metadata from './block.json';

/**
 * Check whether another Simple Payment block earlier in document order
 * already carries this exact blockId (e.g. this block was just duplicated
 * from it).
 *
 * @param {string} clientId This block's client id.
 * @param {string} blockId  This block's current blockId attribute.
 * @return {boolean} True when an earlier block already owns this id.
 */
function isDuplicateBlockId(clientId, blockId) {
	const { getClientIdsWithDescendants, getBlockName, getBlockAttributes } =
		dataSelect('core/block-editor');
	for (const id of getClientIdsWithDescendants()) {
		if (id === clientId) {
			return false;
		}
		if (
			getBlockName(id) === metadata.name &&
			getBlockAttributes(id)?.blockId === blockId
		) {
			return true;
		}
	}
	return false;
}

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
	 * @param {string}   props.clientId      - Block client id
	 * @return {JSX.Element} The edit component
	 */
	edit: ({ attributes, setAttributes, clientId }) => {
		const blockProps = useBlockProps();
		const { blockId, amount, currency, description } = attributes;

		// The blockId assigned here only takes effect on the frontend once the post is
		// saved, so a legacy block (blockId missing before this mount) keeps warning
		// even after the id is generated in-memory — until the user actually saves.
		const [wasMissingBlockId] = useState(() => !blockId);

		// One-time mount snapshot, like wasMissingBlockId above — a live useSelect
		// would re-fire on every store change. Every later duplicate always sees
		// an earlier one's original, not-yet-reassigned id in this snapshot, so
		// document order alone is enough to pick which copy keeps the id.
		const [duplicateBlockId] = useState(() =>
			blockId && isDuplicateBlockId(clientId, blockId)
				? generateUuid()
				: null
		);

		useEffect(() => {
			if (!blockId) {
				setAttributes({ blockId: generateUuid() });
			} else if (duplicateBlockId) {
				setAttributes({ blockId: duplicateBlockId });
			}
			if (!currency) {
				setAttributes({
					currency: window.fairPaymentsConnector?.currency || 'EUR',
				});
			}
		}, []);

		return (
			<div {...blockProps}>
				<div className="fair-payments-connector-block">
					<h3>
						{__('Simple Payment Block', 'fair-payments-connector')}
					</h3>
					{wasMissingBlockId && (
						<Notice status="warning" isDismissible={false}>
							{__(
								'This block is missing an identifier and payments will fail until the post is saved. Save or update the post now.',
								'fair-payments-connector'
							)}
						</Notice>
					)}
					{duplicateBlockId && (
						<Notice status="warning" isDismissible={false}>
							{__(
								'This block shared its identifier with another Simple Payment block on this page, which could cause buyers to be charged the wrong price. A new identifier was assigned — save or update the post now.',
								'fair-payments-connector'
							)}
						</Notice>
					)}
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
