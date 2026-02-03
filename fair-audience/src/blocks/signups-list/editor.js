/**
 * Event Signups List Block - Editor
 */

import './editor.css';
import './frontend.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

/**
 * Register the signups-list block
 */
registerBlockType('fair-audience/signups-list', {
	edit: () => {
		const blockProps = useBlockProps({
			className: 'audience-signups',
		});

		return (
			<div {...blockProps}>
				<div className="audience-signups__preview">
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
							{__('Event Signups List', 'fair-audience')}
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
								'fair-audience'
							)}
						</p>
						<p
							style={{
								margin: '8px 0 0',
								fontSize: '12px',
								color: '#666',
							}}
						>
							{__(
								'Logged-in users see full list, anonymous users see count only.',
								'fair-audience'
							)}
						</p>
					</div>
				</div>
			</div>
		);
	},

	save: () => {
		// Server-side rendering
		return null;
	},
});
