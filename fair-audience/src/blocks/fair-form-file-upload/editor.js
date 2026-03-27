import './style.css';

import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { generateQuestionKey } from '../shared/question-utils.js';

registerBlockType('fair-audience/fair-form-file-upload', {
	edit: ({ attributes, setAttributes }) => {
		const {
			questionText,
			questionKey,
			required,
			acceptedTypes,
			maxFileSize,
		} = attributes;

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
			className: 'fair-form-question fair-form-question-file-upload',
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
								'A unique identifier for this question (e.g. "photo_upload"). Used internally.',
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
							label={__('Accepted File Types', 'fair-audience')}
							value={acceptedTypes}
							onChange={(value) =>
								setAttributes({ acceptedTypes: value })
							}
							help={__(
								'MIME types or extensions (e.g. "image/*", ".pdf,.doc", "image/png,image/jpeg").',
								'fair-audience'
							)}
						/>
						<NumberControl
							label={__('Max File Size (MB)', 'fair-audience')}
							value={maxFileSize}
							onChange={(value) =>
								setAttributes({
									maxFileSize: parseInt(value, 10) || 5,
								})
							}
							min={1}
							max={100}
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
						<input type="file" disabled />
						<span className="fair-form-file-upload-help">
							{__('Max file size:', 'fair-audience')}{' '}
							{maxFileSize} MB
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
