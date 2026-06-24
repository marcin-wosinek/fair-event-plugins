/**
 * Get Tickets Block - Editor Component
 *
 * @package FairEvents
 */

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';
import metadata from './block.json';
import './editor.css';

registerBlockType(metadata.name, {
	...metadata,
	edit: function Edit({ attributes, setAttributes }) {
		const fairAudienceActive =
			window.fairEventsGetTicketsEditorData?.fairAudienceActive;

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

				{fairAudienceActive ? (
					<Notice status="warning" isDismissible={false}>
						{__(
							'fair-audience is active. Use the Event Signup block instead.',
							'fair-events'
						)}
					</Notice>
				) : (
					<div {...blockProps}>
						<ServerSideRender
							block="fair-events/get-tickets"
							attributes={attributes}
						/>
					</div>
				)}
			</>
		);
	},
});
