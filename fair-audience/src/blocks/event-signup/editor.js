import './style.css';
import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	TextareaControl,
	ToggleControl,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSelect } from '@wordpress/data';
import ServerSideRender from '@wordpress/server-side-render';

registerBlockType('fair-audience/event-signup', {
	edit: ({ attributes, setAttributes }) => {
		const {
			signupButtonText,
			registerButtonText,
			requestLinkButtonText,
			successMessage,
			showOptionPrices,
		} = attributes;

		const postType = useSelect(
			(select) => select('core/editor').getCurrentPostType(),
			[]
		);

		const blockProps = useBlockProps({
			className: 'fair-audience-event-signup',
		});

		const eventPostTypes = window.fairAudienceEventPostTypes ?? [];
		const isEventPage =
			eventPostTypes.length === 0 || eventPostTypes.includes(postType);

		if (!isEventPage) {
			return (
				<div {...blockProps}>
					<Notice status="warning" isDismissible={false}>
						{__(
							'This block can only be used on event pages.',
							'fair-audience'
						)}
					</Notice>
				</div>
			);
		}

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
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block="fair-audience/event-signup"
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
