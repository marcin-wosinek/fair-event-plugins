import './style.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	TextareaControl,
	ToggleControl,
	RangeControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

registerBlockType('fair-audience/fair-form-long-text', {
	edit: ({ attributes, setAttributes }) => {
		const { questionText, questionKey, required, placeholder, rows } =
			attributes;

		const blockProps = useBlockProps({
			className: 'fair-form-question fair-form-question-long-text',
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
								'A unique identifier for this question (e.g. "comments"). Used internally.',
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
						<RangeControl
							label={__('Rows', 'fair-audience')}
							value={rows}
							onChange={(value) => setAttributes({ rows: value })}
							min={2}
							max={20}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<TextareaControl
						label={
							questionText
								? questionText + (required ? ' *' : '')
								: __('Long Text Question', 'fair-audience') +
								  (required ? ' *' : '')
						}
						value=""
						placeholder={
							placeholder ||
							__('Type your answer...', 'fair-audience')
						}
						onChange={() => {}}
						rows={rows}
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
