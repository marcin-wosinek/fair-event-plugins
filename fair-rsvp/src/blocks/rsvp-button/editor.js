import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-rsvp/rsvp-button', {
	edit: () => {
		const blockProps = useBlockProps({
			className: 'fair-rsvp-button-editor',
		});

		return (
			<div {...blockProps}>
				<div className="fair-rsvp-preview">
					<p className="fair-rsvp-preview-label">
						{__('RSVP Form Preview', 'fair-rsvp')}
					</p>
					<div className="fair-rsvp-preview-options">
						<label className="fair-rsvp-preview-option">
							<input type="radio" name="preview" value="yes" />
							<span>{__('Yes', 'fair-rsvp')}</span>
						</label>
						<label className="fair-rsvp-preview-option">
							<input type="radio" name="preview" value="maybe" />
							<span>{__('Maybe', 'fair-rsvp')}</span>
						</label>
						<label className="fair-rsvp-preview-option">
							<input type="radio" name="preview" value="no" />
							<span>{__('No', 'fair-rsvp')}</span>
						</label>
					</div>
					<button
						type="button"
						className="fair-rsvp-preview-button"
						disabled
					>
						{__('Update RSVP', 'fair-rsvp')}
					</button>
					<p className="fair-rsvp-preview-note">
						{__(
							'Users will see their current RSVP status and can update it.',
							'fair-rsvp'
						)}
					</p>
				</div>
			</div>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
