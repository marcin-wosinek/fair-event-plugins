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
import ServerSideRender from '@wordpress/server-side-render';
import QuestionBuilder from './QuestionBuilder.js';
import EventLinkPanel from './EventLinkPanel.js';

registerBlockType('fair-audience/audience-signup', {
	edit: ({ attributes, setAttributes }) => {
		const {
			submitButtonText,
			successMessage,
			showInstagram,
			showKeepInformed,
			questions,
			eventDateId,
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
					<PanelBody
						title={__('Questions', 'fair-audience')}
						initialOpen={false}
					>
						<QuestionBuilder
							questions={questions || []}
							onChange={(value) =>
								setAttributes({ questions: value })
							}
						/>
					</PanelBody>
					<PanelBody
						title={__('Event Link', 'fair-audience')}
						initialOpen={false}
					>
						<EventLinkPanel
							eventDateId={eventDateId || 0}
							onChange={(value) =>
								setAttributes({ eventDateId: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<ServerSideRender
						block="fair-audience/audience-signup"
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
