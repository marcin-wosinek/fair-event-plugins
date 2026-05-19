import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-audience/event-interest', {
	edit: ({ attributes, setAttributes }) => {
		const {
			submitButtonText,
			successMessage,
			namePlaceholder,
			emailPlaceholder,
		} = attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-event-interest',
		});

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-audience')}>
						<TextControl
							label={__('Submit Button Text', 'fair-audience')}
							value={submitButtonText}
							onChange={(value) =>
								setAttributes({ submitButtonText: value })
							}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							help={__(
								'Shown after the visitor submits the form.',
								'fair-audience'
							)}
						/>
						<TextControl
							label={__('Email Placeholder', 'fair-audience')}
							value={emailPlaceholder}
							onChange={(value) =>
								setAttributes({ emailPlaceholder: value })
							}
						/>
						<TextControl
							label={__('Name Placeholder', 'fair-audience')}
							value={namePlaceholder}
							onChange={(value) =>
								setAttributes({ namePlaceholder: value })
							}
						/>
					</PanelBody>
				</InspectorControls>
				<div {...blockProps}>
					<div className="fair-audience-event-interest-preview">
						<p>
							<strong>
								{__('Event Interest', 'fair-audience')}
							</strong>
						</p>
						<p>
							{__(
								'Visitors can register their interest in this event without buying a ticket. The form is shown on the front end when this block is placed on an event page.',
								'fair-audience'
							)}
						</p>
						<input
							type="email"
							placeholder={emailPlaceholder}
							disabled
						/>
						<input
							type="text"
							placeholder={namePlaceholder}
							disabled
						/>
						<button type="button" disabled>
							{submitButtonText}
						</button>
					</div>
				</div>
			</>
		);
	},
	save: () => null,
});
