import './style.css';

import { registerBlockType, createBlock } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { getSettings } from '@wordpress/date';
import {
	autosizeTextarea,
	generateQuestionKey,
	resolvePhonePlaceholder,
} from 'fair-events-shared';

registerBlockType('fair-audience/fair-form-phone', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: ['fair-audience/fair-form-short-text'],
				transform: (attributes) => {
					return createBlock(
						'fair-audience/fair-form-short-text',
						attributes
					);
				},
			},
		],
	},
	edit: ({ attributes, setAttributes }) => {
		const { questionText, questionKey, required, placeholder } = attributes;
		const timezoneString = getSettings().timezone.string;
		const derivedPlaceholder = resolvePhonePlaceholder('', timezoneString);

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
			className: 'fair-form-question fair-form-question-phone',
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
								'A unique identifier for this question (e.g. "mobile_phone"). Used internally.',
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
							placeholder={derivedPlaceholder}
							help={__(
								'Must include country code with leading "+" (e.g. +49 170 123 45 67). Leave empty to use the example for your site’s timezone.',
								'fair-audience'
							)}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<p>
						<span className="fair-form-question-header">
							<textarea
								rows={1}
								ref={autosizeTextarea}
								value={questionText}
								onChange={(e) => {
									autosizeTextarea(e.target);
									onQuestionTextChange(e.target.value);
								}}
								placeholder={__(
									'Enter your question...',
									'fair-audience'
								)}
								className="fair-form-question-label-input"
							/>
							{required && <span className="required"> *</span>}
						</span>
						<br />
						<input
							type="tel"
							disabled
							placeholder={resolvePhonePlaceholder(
								placeholder,
								timezoneString
							)}
						/>
					</p>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
});
