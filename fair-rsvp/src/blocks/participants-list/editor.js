/**
 * RSVP Participants List Block - Editor
 */

import './editor.css';
import './frontend.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, SelectControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

/**
 * Register the participants-list block
 */
registerBlockType('fair-rsvp/participants-list', {
	edit: ({ attributes, setAttributes, context }) => {
		const { showStatus } = attributes;
		const blockProps = useBlockProps({
			className: 'rsvp-participants',
		});

		// Get current post ID from context or current post
		const postId =
			context.postId ||
			useSelect((select) => {
				return select('core/editor')?.getCurrentPostId();
			}, []);

		// Fetch participants data
		const { participants, isLoading } = useSelect(
			(select) => {
				if (!postId) {
					return { participants: [], isLoading: false };
				}

				// Try to get from REST API
				const { getEntityRecords } = select(coreStore);

				// For preview, we'll use a simpler approach
				// In a real scenario, we'd fetch from the REST endpoint
				return {
					participants: [], // Placeholder
					isLoading: false,
				};
			},
			[postId, showStatus]
		);

		return (
			<>
				<InspectorControls>
					<PanelBody
						title={__('Participant Settings', 'fair-rsvp')}
						initialOpen={true}
					>
						<SelectControl
							label={__(
								'Show participants with status',
								'fair-rsvp'
							)}
							value={showStatus}
							options={[
								{ label: __('Yes', 'fair-rsvp'), value: 'yes' },
								{
									label: __('Maybe', 'fair-rsvp'),
									value: 'maybe',
								},
								{ label: __('No', 'fair-rsvp'), value: 'no' },
							]}
							onChange={(value) =>
								setAttributes({ showStatus: value })
							}
							help={__(
								'Choose which RSVP status to display in the participant list.',
								'fair-rsvp'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<div className="rsvp-participants__preview">
						<div
							style={{
								padding: '20px',
								border: '2px dashed #ccc',
								borderRadius: '4px',
								textAlign: 'center',
								backgroundColor: '#f9f9f9',
							}}
						>
							<p style={{ margin: 0, color: '#666' }}>
								{__('RSVP Participants List', 'fair-rsvp')}
							</p>
							<p
								style={{
									margin: '8px 0 0',
									fontSize: '12px',
									color: '#999',
								}}
							>
								{__(
									'Preview available on frontend only',
									'fair-rsvp'
								)}
							</p>
							<p
								style={{
									margin: '8px 0 0',
									fontSize: '12px',
									color: '#666',
								}}
							>
								{__('Showing:', 'fair-rsvp')}{' '}
								<strong>
									{showStatus === 'yes' &&
										__('Yes', 'fair-rsvp')}
									{showStatus === 'maybe' &&
										__('Maybe', 'fair-rsvp')}
									{showStatus === 'no' &&
										__('No', 'fair-rsvp')}
								</strong>
							</p>
						</div>
					</div>
				</div>
			</>
		);
	},

	save: () => {
		// Server-side rendering
		return null;
	},
});
