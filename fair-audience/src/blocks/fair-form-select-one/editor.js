import './style.css';

import { registerBlockType, createBlock } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	SelectControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generateQuestionKey } from '../shared/question-utils.js';
import OptionsEditor from '../shared/OptionsEditor.js';

registerBlockType('fair-audience/fair-form-select-one', {
	transforms: {
		to: [
			{
				type: 'block',
				blocks: ['fair-audience/fair-form-multiselect'],
				transform: (attributes) => {
					const { displayAs, ...rest } = attributes;
					return createBlock(
						'fair-audience/fair-form-multiselect',
						rest
					);
				},
			},
		],
	},
	edit: ({ attributes, setAttributes }) => {
		const { questionText, questionKey, required, options, displayAs } =
			attributes;

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
			className: 'fair-form-question fair-form-question-select-one',
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
								'A unique identifier for this question. Used internally.',
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
						<SelectControl
							label={__('Display as', 'fair-audience')}
							value={displayAs}
							options={[
								{
									label: __('Dropdown', 'fair-audience'),
									value: 'select',
								},
								{
									label: __('Radio buttons', 'fair-audience'),
									value: 'radio',
								},
							]}
							onChange={(value) =>
								setAttributes({ displayAs: value })
							}
						/>
					</PanelBody>
					<PanelBody title={__('Options', 'fair-audience')}>
						<OptionsEditor
							options={options}
							onChange={(value) =>
								setAttributes({ options: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div {...blockProps}>
					<p>
						<input
							type="text"
							value={questionText}
							onChange={(e) =>
								onQuestionTextChange(e.target.value)
							}
							placeholder={__(
								'Enter your question...',
								'fair-audience'
							)}
							className="fair-form-question-label-input"
						/>
						{required && <span className="required"> *</span>}
						<br />
						{displayAs === 'select' && (
							<select disabled>
								<option value="">
									{__('Select an option...', 'fair-audience')}
								</option>
								{options.map((opt, i) => (
									<option key={i} value={opt}>
										{opt}
									</option>
								))}
							</select>
						)}
						{displayAs === 'radio' && (
							<span className="fair-form-radio-preview">
								{options.length === 0 && (
									<em>
										{__(
											'Add options in the sidebar',
											'fair-audience'
										)}
									</em>
								)}
								{options.map((opt, i) => (
									<label key={i}>
										<input
											type="radio"
											disabled
											name="preview"
										/>
										{opt}
									</label>
								))}
							</span>
						)}
					</p>
				</div>
			</>
		);
	},
	save: () => {
		return null;
	},
});
