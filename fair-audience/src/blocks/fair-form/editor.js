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

const ALLOWED_BLOCKS = [
	'core/heading',
	'core/paragraph',
	'core/list',
	'fair-audience/fair-form-short-text',
	'fair-audience/fair-form-long-text',
	'fair-audience/fair-form-select-one',
	'fair-audience/fair-form-multiselect',
	'fair-audience/fair-form-radio',
	'fair-audience/fair-form-file-upload',
];

registerBlockType('fair-audience/fair-form', {
	edit: ({ attributes, setAttributes }) => {
		const {
			submitButtonText,
			successMessage,
			showKeepInformed,
			eventDateId,
		} = attributes;

		const blockProps = useBlockProps({
			className: 'fair-form',
		});

		const innerBlocksProps = useInnerBlocksProps(
			{ className: 'fair-form-inner-blocks' },
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
							label={__('Submit Button Text', 'fair-audience')}
							value={submitButtonText}
							onChange={(value) =>
								setAttributes({ submitButtonText: value })
							}
							placeholder={__('Submit', 'fair-audience')}
						/>
						<TextareaControl
							label={__('Success Message', 'fair-audience')}
							value={successMessage}
							onChange={(value) =>
								setAttributes({ successMessage: value })
							}
							placeholder={__(
								'Thank you for your submission!',
								'fair-audience'
							)}
							help={__(
								'Message shown after successful form submission.',
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
								'Adds a marketing opt-in checkbox to the form.',
								'fair-audience'
							)}
						/>
						<TextControl
							label={__('Event Date ID', 'fair-audience')}
							type="number"
							value={eventDateId || ''}
							onChange={(value) =>
								setAttributes({
									eventDateId: parseInt(value, 10) || 0,
								})
							}
							help={__(
								'Optional. Link this form to a specific event date.',
								'fair-audience'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<div className="fair-form-editor-header">
						<span className="fair-form-editor-label">
							{__('Fair Form', 'fair-audience')}
						</span>
					</div>
					<div className="fair-form-editor-fields">
						<div className="fair-form-editor-field">
							<label>{__('First Name', 'fair-audience')} *</label>
							<input type="text" disabled />
						</div>
						<div className="fair-form-editor-field">
							<label>{__('Last Name', 'fair-audience')}</label>
							<input type="text" disabled />
						</div>
						<div className="fair-form-editor-field">
							<label>{__('Email', 'fair-audience')} *</label>
							<input type="email" disabled />
						</div>
						{showKeepInformed && (
							<div className="fair-form-editor-field">
								<label>
									<input type="checkbox" disabled />
									{__('Keep me informed', 'fair-audience')}
								</label>
							</div>
						)}
					</div>
					<div {...innerBlocksProps} />
					<div className="fair-form-editor-footer">
						<div className="wp-block-button">
							<button
								className="wp-block-button__link wp-element-button"
								disabled
							>
								{submitButtonText ||
									__('Submit', 'fair-audience')}
							</button>
						</div>
					</div>
				</div>
			</>
		);
	},
	save: () => {
		return <InnerBlocks.Content />;
	},
});
