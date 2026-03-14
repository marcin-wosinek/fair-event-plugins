import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ServerSideRender from '@wordpress/server-side-render';

registerBlockType('fair-audience/mailing-signup', {
	edit: ({ attributes, setAttributes }) => {
		const { submitButtonText, successMessage } = attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-mailing-signup',
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
							placeholder={__('Subscribe', 'fair-audience')}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							placeholder={__(
								'Please check your email to confirm your subscription.',
								'fair-audience'
							)}
							help={__(
								'Message shown after successful signup.',
								'fair-audience'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block="fair-audience/mailing-signup"
						attributes={attributes}
					/>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
