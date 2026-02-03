import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, TextareaControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType( 'fair-audience/event-signup', {
	edit: ( { attributes, setAttributes } ) => {
		const {
			signupButtonText,
			registerButtonText,
			requestLinkButtonText,
			successMessage,
		} = attributes;

		const blockProps = useBlockProps( {
			className: 'fair-audience-event-signup',
		} );

		return (
			<>
				<InspectorControls>
					<PanelBody title={ __( 'Form Settings', 'fair-audience' ) }>
						<TextControl
							label={ __(
								'Signup Button Text',
								'fair-audience'
							) }
							value={ signupButtonText }
							onChange={ ( value ) =>
								setAttributes( { signupButtonText: value } )
							}
							placeholder={ __( 'Sign Up', 'fair-audience' ) }
							help={ __(
								'Button text for authenticated users.',
								'fair-audience'
							) }
						/>
						<TextControl
							label={ __(
								'Register Button Text',
								'fair-audience'
							) }
							value={ registerButtonText }
							onChange={ ( value ) =>
								setAttributes( { registerButtonText: value } )
							}
							placeholder={ __(
								'Register & Sign Up',
								'fair-audience'
							) }
							help={ __(
								'Button text for new registrations.',
								'fair-audience'
							) }
						/>
						<TextControl
							label={ __(
								'Request Link Button Text',
								'fair-audience'
							) }
							value={ requestLinkButtonText }
							onChange={ ( value ) =>
								setAttributes( {
									requestLinkButtonText: value,
								} )
							}
							placeholder={ __(
								'Send Signup Link',
								'fair-audience'
							) }
							help={ __(
								'Button text for existing participants.',
								'fair-audience'
							) }
						/>
						<TextareaControl
							label={ __( 'Success Message', 'fair-audience' ) }
							value={ successMessage }
							onChange={ ( value ) =>
								setAttributes( { successMessage: value } )
							}
							placeholder={ __(
								'You have successfully signed up for the event!',
								'fair-audience'
							) }
							help={ __(
								'Message shown after successful signup.',
								'fair-audience'
							) }
						/>
					</PanelBody>
				</InspectorControls>

				<div { ...blockProps }>
					<div className="fair-audience-event-signup-preview">
						<p className="fair-audience-event-signup-notice">
							{ __(
								'Event Signup form - displays based on user state',
								'fair-audience'
							) }
						</p>

						<div className="fair-audience-event-signup-preview-tabs">
							<span className="preview-tab active">
								{ __( 'Anonymous', 'fair-audience' ) }
							</span>
							<span className="preview-tab">
								{ __( 'With Token', 'fair-audience' ) }
							</span>
							<span className="preview-tab">
								{ __( 'Logged In', 'fair-audience' ) }
							</span>
						</div>

						<form className="fair-audience-signup-form fair-audience-signup-register">
							<p>
								<label>
									{ __( 'First Name', 'fair-audience' ) }{ ' ' }
									<span className="required">*</span>
								</label>
								<input
									type="text"
									placeholder={ __(
										'Enter your first name',
										'fair-audience'
									) }
									disabled
								/>
							</p>
							<p>
								<label>
									{ __( 'Surname', 'fair-audience' ) }
								</label>
								<input
									type="text"
									placeholder={ __(
										'Enter your surname',
										'fair-audience'
									) }
									disabled
								/>
							</p>
							<p>
								<label>
									{ __( 'Email', 'fair-audience' ) }{ ' ' }
									<span className="required">*</span>
								</label>
								<input
									type="email"
									placeholder={ __(
										'Enter your email',
										'fair-audience'
									) }
									disabled
								/>
							</p>
							<p className="fair-audience-signup-checkbox">
								<label>
									<input type="checkbox" disabled />
									{ __(
										'Keep me informed about future events',
										'fair-audience'
									) }
								</label>
							</p>

							<div className="wp-block-button">
								<button
									type="button"
									className="wp-block-button__link wp-element-button"
									disabled
								>
									{ registerButtonText ||
										__(
											'Register & Sign Up',
											'fair-audience'
										) }
								</button>
							</div>
						</form>
					</div>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
} );
