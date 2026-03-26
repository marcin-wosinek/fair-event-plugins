import './style.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-audience/fair-form-short-text', {
	edit: ({ attributes, setAttributes }) => {
		const { questionText, questionKey, required, placeholder } = attributes;

		const blockProps = useBlockProps({
			className: 'fair-form-question fair-form-question-short-text',
		});

		return (
			<>
				<InspectorControls>
					<PanelBody title={__('Question Settings', 'fair-audience')}>
						<TextControl
							label={__('Question Key', 'fair-audience')}
							value={questionKey}
							onChange={(value) =>
								setAttributes({ questionKey: value })
							}
							help={__(
								'A unique identifier for this question (e.g. "favorite_color"). Used internally.',
								'fair-audience'
							)}
						/>
						<ToggleControl
							label={__('Required', 'fair-audience')}
							checked={required}
							onChange={(value) =>
								setAttributes({ required: value })
							}
						/>
						<TextControl
							label={__('Placeholder', 'fair-audience')}
							value={placeholder}
							onChange={(value) =>
								setAttributes({ placeholder: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<TextControl
						label={
							questionText
								? questionText + (required ? ' *' : '')
								: __('Short Text Question', 'fair-audience') +
								  (required ? ' *' : '')
						}
						value=""
						placeholder={
							placeholder ||
							__('Type your answer...', 'fair-audience')
						}
						onChange={() => {}}
						disabled
					/>
					<TextControl
						className="fair-form-question-text-input"
						value={questionText}
						onChange={(value) =>
							setAttributes({ questionText: value })
						}
						placeholder={__(
							'Enter your question text...',
							'fair-audience'
						)}
						hideLabelFromVision
					/>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
});
