import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';

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
							placeholder={__(
								'Register interest',
								'fair-audience'
							)}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							placeholder={__(
								'Thanks! Check your inbox for confirmation.',
								'fair-audience'
							)}
							help={__(
								'Message shown after the visitor submits the form.',
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
					<ServerSideRender
						block="fair-audience/event-interest"
						attributes={attributes}
					/>
				</div>
			</>
		);
	},
	save: () => null,
});
