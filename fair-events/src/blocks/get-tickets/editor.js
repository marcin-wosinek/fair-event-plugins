/**
 * Get Tickets Block - Editor Component (legacy alias)
 *
 * Hidden from the inserter (block.json supports.inserter: false). Existing
 * instances still render — via the unified fair-events/event-signup block — and
 * can be transformed to it. Shows a one-line notice pointing editors at the
 * replacement.
 *
 * @package FairEvents
 */

import { registerBlockType, createBlock } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';
import './editor.css';

const UNIFIED_NAME = 'fair-events/event-signup';

registerBlockType(metadata.name, {
	...metadata,
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [UNIFIED_NAME],
				transform: (attributes) =>
					createBlock(UNIFIED_NAME, { ...attributes }),
			},
		],
	},
	edit: function Edit({ attributes }) {
		const blockProps = useBlockProps();

		return (
			<div {...blockProps}>
				<Notice status="info" isDismissible={false}>
					{__(
						'This block has moved to Event Signup. Transform it to the new block.',
						'fair-events'
					)}
				</Notice>
				<ServerSideRender
					block={metadata.name}
					attributes={attributes}
				/>
			</div>
		);
	},
});
