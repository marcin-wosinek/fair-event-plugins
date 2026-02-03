import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

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
					<form className="fair-audience-mailing-form">
						<p>
							<label>
								{__('First Name', 'fair-audience')}{' '}
								<span className="required">*</span>
							</label>
							<input
								type="text"
								placeholder={__(
									'Enter your first name',
									'fair-audience'
								)}
								disabled
							/>
						</p>
						<p>
							<label>
								{__('Last Name', 'fair-audience')}{' '}
								<span className="required">*</span>
							</label>
							<input
								type="text"
								placeholder={__(
									'Enter your last name',
									'fair-audience'
								)}
								disabled
							/>
						</p>
						<p>
							<label>
								{__('Email', 'fair-audience')}{' '}
								<span className="required">*</span>
							</label>
							<input
								type="email"
								placeholder={__(
									'Enter your email',
									'fair-audience'
								)}
								disabled
							/>
						</p>

						<div className="wp-block-button">
							<button
								type="button"
								className="wp-block-button__link wp-element-button"
								disabled
							>
								{submitButtonText ||
									__('Subscribe', 'fair-audience')}
							</button>
						</div>
					</form>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
