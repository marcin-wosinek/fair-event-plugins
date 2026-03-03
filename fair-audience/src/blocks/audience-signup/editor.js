import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-audience/audience-signup', {
	edit: ({ attributes, setAttributes }) => {
		const {
			submitButtonText,
			successMessage,
			showInstagram,
			showKeepInformed,
		} = attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-audience-signup',
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
							placeholder={__('Register', 'fair-audience')}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							placeholder={__(
								'You have been registered successfully!',
								'fair-audience'
							)}
							help={__(
								'Message shown after successful registration.',
								'fair-audience'
							)}
						/>
						<ToggleControl
							label={__('Show Instagram field', 'fair-audience')}
							checked={showInstagram}
							onChange={(value) =>
								setAttributes({ showInstagram: value })
							}
							help={__(
								'Show an optional Instagram username field.',
								'fair-audience'
							)}
						/>
						<ToggleControl
							label={__(
								'Show "Keep me informed" checkbox',
								'fair-audience'
							)}
							checked={showKeepInformed}
							onChange={(value) =>
								setAttributes({ showKeepInformed: value })
							}
							help={__(
								'Allow users to opt-in to future event notifications.',
								'fair-audience'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<form className="fair-audience-audience-form">
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
							<label>{__('Last Name', 'fair-audience')}</label>
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

						{showInstagram && (
							<p>
								<label>
									{__('Instagram', 'fair-audience')}
								</label>
								<input
									type="text"
									placeholder={__(
										'@username',
										'fair-audience'
									)}
									disabled
								/>
							</p>
						)}

						{showKeepInformed && (
							<div className="fair-audience-audience-checkbox">
								<label>
									<input type="checkbox" disabled />
									{__(
										'Keep me informed about future events',
										'fair-audience'
									)}
								</label>
							</div>
						)}

						<div className="wp-block-button">
							<button
								type="button"
								className="wp-block-button__link wp-element-button"
								disabled
							>
								{submitButtonText ||
									__('Register', 'fair-audience')}
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
