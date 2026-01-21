import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-audience/mailing-signup', {
	edit: ({ attributes, setAttributes }) => {
		const { title, description, submitButtonText, successMessage } =
			attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-mailing-signup-editor',
		});

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-audience')}>
						<TextControl
							label={__('Title', 'fair-audience')}
							value={title}
							onChange={(value) =>
								setAttributes({ title: value })
							}
							placeholder={__(
								'Subscribe to our newsletter',
								'fair-audience'
							)}
							help={__(
								'Optional title displayed above the form.',
								'fair-audience'
							)}
						/>
						<TextareaControl
							label={__('Description', 'fair-audience')}
							value={description}
							onChange={(value) =>
								setAttributes({ description: value })
							}
							placeholder={__(
								'Stay updated with our latest news and events.',
								'fair-audience'
							)}
							help={__(
								'Optional description displayed below the title.',
								'fair-audience'
							)}
						/>
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
					<div className="fair-audience-mailing-signup-preview">
						{title && (
							<h3 className="fair-audience-mailing-signup-preview-title">
								{title}
							</h3>
						)}
						{description && (
							<p className="fair-audience-mailing-signup-preview-description">
								{description}
							</p>
						)}
						<div className="fair-audience-mailing-signup-preview-form">
							<div className="fair-audience-mailing-signup-preview-fields">
								<div className="fair-audience-mailing-signup-preview-field">
									<label>
										{__('First Name', 'fair-audience')}
									</label>
									<input
										type="text"
										placeholder={__(
											'Enter your first name',
											'fair-audience'
										)}
										disabled
									/>
								</div>
								<div className="fair-audience-mailing-signup-preview-field">
									<label>
										{__('Last Name', 'fair-audience')}
									</label>
									<input
										type="text"
										placeholder={__(
											'Enter your last name',
											'fair-audience'
										)}
										disabled
									/>
								</div>
								<div className="fair-audience-mailing-signup-preview-field fair-audience-mailing-signup-preview-field-email">
									<label>
										{__('Email', 'fair-audience')}
									</label>
									<input
										type="email"
										placeholder={__(
											'Enter your email',
											'fair-audience'
										)}
										disabled
									/>
								</div>
							</div>
							<button
								type="button"
								className="fair-audience-mailing-signup-preview-button"
								disabled
							>
								{submitButtonText ||
									__('Subscribe', 'fair-audience')}
							</button>
						</div>
						<p className="fair-audience-mailing-signup-preview-note">
							{__(
								'Users will receive a confirmation email after signing up.',
								'fair-audience'
							)}
						</p>
					</div>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
