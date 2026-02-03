/**
 * Event Proposal Form Block - Editor Component
 *
 * @package FairEvents
 */

import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody, ToggleControl, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import metadata from './block.json';
import './editor.css';
import './frontend.css';

registerBlockType( metadata.name, {
	...metadata,
	edit: function Edit( { attributes, setAttributes } ) {
		return (
			<>
				<InspectorControls>
					<PanelBody title={ __( 'Form Settings', 'fair-events' ) }>
						<ToggleControl
							label={ __( 'Enable Categories', 'fair-events' ) }
							checked={ attributes.enableCategories }
							onChange={ ( value ) =>
								setAttributes( { enableCategories: value } )
							}
							help={ __(
								'Allow users to select event categories',
								'fair-events'
							) }
						/>
						<ToggleControl
							label={ __( 'Enable Description', 'fair-events' ) }
							checked={ attributes.enableDescription }
							onChange={ ( value ) =>
								setAttributes( { enableDescription: value } )
							}
							help={ __(
								'Include a description field in the form',
								'fair-events'
							) }
						/>
						<ToggleControl
							label={ __(
								'Enable Admin Notifications',
								'fair-events'
							) }
							checked={ attributes.enableNotifications }
							onChange={ ( value ) =>
								setAttributes( { enableNotifications: value } )
							}
							help={ __(
								'Send email when new proposals are submitted',
								'fair-events'
							) }
						/>
						{ attributes.enableNotifications && (
							<TextControl
								label={ __(
									'Notification Email',
									'fair-events'
								) }
								value={ attributes.notificationEmail }
								onChange={ ( value ) =>
									setAttributes( {
										notificationEmail: value,
									} )
								}
								type="email"
								help={ __(
									'Email address for notifications',
									'fair-events'
								) }
							/>
						) }
						<TextControl
							label={ __( 'Submit Button Text', 'fair-events' ) }
							value={ attributes.submitButtonText }
							onChange={ ( value ) =>
								setAttributes( { submitButtonText: value } )
							}
						/>
						<TextControl
							label={ __( 'Success Message', 'fair-events' ) }
							value={ attributes.successMessage }
							onChange={ ( value ) =>
								setAttributes( { successMessage: value } )
							}
							help={ __(
								'Message shown after successful submission',
								'fair-events'
							) }
						/>
					</PanelBody>
				</InspectorControls>

				<div className="fair-events-proposal-placeholder">
					<div className="placeholder-icon">📝</div>
					<h3>{ __( 'Event Proposal Form', 'fair-events' ) }</h3>
					<p>
						{ __(
							'Form will be displayed on the frontend',
							'fair-events'
						) }
					</p>
					<div className="placeholder-info">
						{ attributes.enableCategories && (
							<span className="info-tag">
								{ __( 'Categories enabled', 'fair-events' ) }
							</span>
						) }
						{ attributes.enableDescription && (
							<span className="info-tag">
								{ __( 'Description enabled', 'fair-events' ) }
							</span>
						) }
						{ attributes.enableNotifications && (
							<span className="info-tag">
								{ __( 'Notifications enabled', 'fair-events' ) }
							</span>
						) }
					</div>
				</div>
			</>
		);
	},
} );
