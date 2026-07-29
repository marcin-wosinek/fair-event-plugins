import './style.css';
import './editor.css';

import { registerBlockType, createBlock } from '@wordpress/blocks';
import {
	useBlockProps,
	useInnerBlocksProps,
	InspectorControls,
	InnerBlocks,
} from '@wordpress/block-editor';
import { PanelBody, TextControl, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const UNIFIED_NAME = 'fair-events/event-signup';

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

// The file-upload question can nest inside a conditional block, so this
// scans the whole inner-block tree rather than just the top level.
function hasFileUploadQuestion(blocks) {
	return (blocks || []).some(
		(block) =>
			block.name === 'fair-audience/fair-form-file-upload' ||
			hasFileUploadQuestion(block.innerBlocks)
	);
}

registerBlockType('fair-audience/event-signup', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: [UNIFIED_NAME],
				// A nested file-upload question would silently lose upload
				// handling on the unified block (no vetted anonymous-upload
				// path yet) — withhold the transform in that case. Other
				// questions survive the transform via innerBlocks below.
				isMatch: (attributes, block) =>
					!hasFileUploadQuestion(block.innerBlocks),
				transform: (attributes, innerBlocks) =>
					createBlock(
						UNIFIED_NAME,
						{ submitButtonText: attributes.signupButtonText },
						innerBlocks
					),
			},
		],
	},
	edit: ({ attributes, setAttributes }) => {
		const { signupButtonText } = attributes;

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
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<Notice status="info" isDismissible={false}>
						{__(
							'This block has moved to Event Signup (fair-events). Transform it to the new block.',
							'fair-audience'
						)}
					</Notice>
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
								{__('Register & Sign Up', 'fair-audience')}
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
