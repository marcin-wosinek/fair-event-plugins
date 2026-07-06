import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

// Custom question blocks that can be nested inside the signup form. Mirrors the
// Fair Form block's set (see fair-form/editor.js) so organizers collect the same
// extra information during event registration. `fair-form-option` is omitted
// because it is a child of the select/radio/multiselect blocks, not a top-level
// question.
const ALLOWED_BLOCKS = [
	'core/heading',
	'core/paragraph',
	'core/list',
	'fair-audience/fair-form-short-text',
	'fair-audience/fair-form-long-text',
	'fair-audience/fair-form-phone',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-radio',
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-file-upload',
	'fair-audience/fair-form-consent',
	'fair-audience/fair-form-conditional',
];

registerBlockType('fair-audience/event-signup', {
	edit: ({ attributes, setAttributes }) => {
		const {
			signupButtonText,
			registerButtonText,
			requestLinkButtonText,
			successMessage,
			showOptionPrices,
			showTicketTypePrices,
			showInviterName,
		} = attributes;

		const blockProps = useBlockProps({
			className: 'fair-audience-event-signup',
		});

		const innerBlocksProps = useInnerBlocksProps(
			{ className: 'fair-audience-event-signup-questions' },
			{
				allowedBlocks: ALLOWED_BLOCKS,
				renderAppender: InnerBlocks.ButtonBlockAppender,
			}
		);

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Form Settings', 'fair-audience')}>
						<TextControl
							label={__('Signup Button Text', 'fair-audience')}
							value={signupButtonText}
							onChange={(value) =>
								setAttributes({ signupButtonText: value })
							}
							placeholder={__('Sign Up', 'fair-audience')}
							help={__(
								'Button text for authenticated users.',
								'fair-audience'
							)}
						/>
						<TextControl
							label={__('Register Button Text', 'fair-audience')}
							value={registerButtonText}
							onChange={(value) =>
								setAttributes({ registerButtonText: value })
							}
							placeholder={__(
								'Register & Sign Up',
								'fair-audience'
							)}
							help={__(
								'Button text for new registrations.',
								'fair-audience'
							)}
						/>
						<TextControl
							label={__(
								'Request Link Button Text',
								'fair-audience'
							)}
							value={requestLinkButtonText}
							onChange={(value) =>
								setAttributes({
									requestLinkButtonText: value,
								})
							}
							placeholder={__(
								'Send Signup Link',
								'fair-audience'
							)}
							help={__(
								'Button text for existing participants.',
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
								'You have successfully signed up for the event!',
								'fair-audience'
							)}
							help={__(
								'Message shown after successful signup.',
								'fair-audience'
							)}
						/>
						<ToggleControl
							label={__(
								'Show ticket type prices',
								'fair-audience'
							)}
							help={__(
								'Display the price of each ticket type next to its label.',
								'fair-audience'
							)}
							checked={showTicketTypePrices}
							onChange={(value) =>
								setAttributes({
									showTicketTypePrices: value,
								})
							}
						/>
						<ToggleControl
							label={__(
								'Show activity option prices',
								'fair-audience'
							)}
							help={__(
								'Display the price of each activity option next to its label. The running total in the button always updates regardless of this setting.',
								'fair-audience'
							)}
							checked={showOptionPrices}
							onChange={(value) =>
								setAttributes({ showOptionPrices: value })
							}
						/>
						<ToggleControl
							label={__('Show inviter name', 'fair-audience')}
							help={__(
								'When a visitor arrives via an invitation link, show the name of the person who invited them.',
								'fair-audience'
							)}
							checked={showInviterName}
							onChange={(value) =>
								setAttributes({ showInviterName: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<div className="fair-audience-event-signup-editor-header">
						<span className="fair-audience-event-signup-editor-label">
							{__('Event Signup', 'fair-audience')}
						</span>
					</div>
					<div className="fair-audience-event-signup-editor-fields">
						<div className="fair-audience-event-signup-editor-field">
							<label>{__('First Name', 'fair-audience')} *</label>
							<input type="text" disabled />
						</div>
						<div className="fair-audience-event-signup-editor-field">
							<label>{__('Surname', 'fair-audience')}</label>
							<input type="text" disabled />
						</div>
						<div className="fair-audience-event-signup-editor-field">
							<label>{__('Email', 'fair-audience')} *</label>
							<input type="email" disabled />
						</div>
					</div>
					<p className="fair-audience-event-signup-editor-note">
						{__(
							'Ticket types, activity options and pricing are rendered on the published page based on the event.',
							'fair-audience'
						)}
					</p>
					<div className="fair-audience-event-signup-editor-questions-label">
						{__('Custom questions', 'fair-audience')}
					</div>
					<div {...innerBlocksProps} />
					<div className="fair-audience-event-signup-editor-footer">
						<div className="wp-block-button">
							<button
								className="wp-block-button__link wp-element-button"
								disabled
							>
								{registerButtonText ||
									__('Register & Sign Up', 'fair-audience')}
							</button>
						</div>
					</div>
				</div>
			</>
		);
	},
	save: () => {
		// Dynamic block (rendered via render.php), but the nested question
		// blocks must be serialized so render.php receives them as $content.
		return <InnerBlocks.Content />;
	},
	deprecated: [
		{
			// Previously a pure dynamic block with no saved markup. Existing
			// instances have no inner blocks, so migrating them to the
			// InnerBlocks.Content save is a no-op that avoids block recovery.
			save: () => null,
		},
	],
});
