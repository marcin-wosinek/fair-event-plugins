/**
 * Event Signup Block - Editor Component
 *
 * Canonical fair-events signup block. Base behaviour is the anonymous
 * get-tickets form; when fair-audience is active the render delegates to its
 * participant-aware flow.
 *
 * The legacy fair-audience/event-signup and fair-events/get-tickets blocks
 * hide themselves from the inserter and register their own transforms to
 * this block.
 *
 * @package FairEvents
 */

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';
import './editor.css';

const UNIFIED_NAME = 'fair-events/event-signup';

registerBlockType(metadata.name, {
	...metadata,
	edit: function Edit({ attributes, setAttributes }) {
		const blockProps = useBlockProps();

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-events')}>
						<TextControl
							label={__('Submit Button Text', 'fair-events')}
							value={attributes.submitButtonText}
							onChange={(value) =>
								setAttributes({ submitButtonText: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block={UNIFIED_NAME}
						attributes={attributes}
					/>
				</div>
			</>
		);
	},
});
