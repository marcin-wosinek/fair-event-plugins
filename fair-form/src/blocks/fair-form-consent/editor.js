import './style.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generateQuestionKey } from 'fair-events-shared';

registerBlockType('fair-audience/fair-form-consent', {
	edit: ({ attributes, setAttributes }) => {
		const { questionText, questionKey, required } = attributes;

		const onQuestionTextChange = (value) => {
			const updates = { questionText: value };
			if (
				!questionKey ||
				questionKey === generateQuestionKey(questionText)
			) {
				updates.questionKey = generateQuestionKey(value);
			}
			setAttributes(updates);
		};

		const blockProps = useBlockProps({
			className: 'fair-form-question fair-form-question-consent',
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
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<p>
						<input type="checkbox" disabled />
						<span className="fair-form-question-header">
							<textarea
								rows={1}
								value={questionText}
								onChange={(e) =>
									onQuestionTextChange(e.target.value)
								}
								placeholder={__(
									'I have read and accept the terms and conditions',
									'fair-audience'
								)}
								className="fair-form-question-label-input"
							/>
							{required && <span className="required"> *</span>}
						</span>
					</p>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
});
