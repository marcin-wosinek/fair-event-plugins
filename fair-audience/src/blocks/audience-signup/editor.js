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
import QuestionBuilder from './QuestionBuilder.js';
import EventLinkPanel from './EventLinkPanel.js';

function QuestionPreview({ question }) {
	const { text, type, required, options } = question;

	const label = (
		<label>
			{text || __('Untitled Question', 'fair-audience')}
			{required && <span className="required"> *</span>}
		</label>
	);

	switch (type) {
		case 'long_text':
			return (
				<div className="fair-audience-audience-question-group">
					{label}
					<textarea disabled rows="3" />
				</div>
			);
		case 'number':
			return (
				<p>
					{label}
					<input type="number" disabled />
				</p>
			);
		case 'date':
			return (
				<p>
					{label}
					<input type="date" disabled />
				</p>
			);
		case 'select':
			return (
				<p>
					{label}
					<select disabled>
						<option value="">
							{__('Select...', 'fair-audience')}
						</option>
						{(options || []).map((opt, i) => (
							<option key={i} value={opt}>
								{opt}
							</option>
						))}
					</select>
				</p>
			);
		case 'radio':
			return (
				<fieldset
					className="fair-audience-audience-question-group"
					disabled
				>
					<legend>{label}</legend>
					{(options || []).map((opt, i) => (
						<label key={i} className="fair-audience-option-label">
							<input type="radio" disabled />
							{opt}
						</label>
					))}
				</fieldset>
			);
		case 'checkbox':
			return (
				<fieldset
					className="fair-audience-audience-question-group"
					disabled
				>
					<legend>{label}</legend>
					{(options || []).map((opt, i) => (
						<label key={i} className="fair-audience-option-label">
							<input type="checkbox" disabled />
							{opt}
						</label>
					))}
				</fieldset>
			);
		case 'short_text':
		default:
			return (
				<p>
					{label}
					<input type="text" disabled />
				</p>
			);
	}
}

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
					<form className="fair-audience-audience-form">
						<p>
							<label>
								{__('First Name', 'fair-audience')}{' '}
								<span className="required">*</span>
							</label>
							<input
								type="text"
								placeholder={__(
									'Enter your first name',
									'fair-audience'
								)}
								disabled
							/>
						</p>
						<p>
							<label>{__('Last Name', 'fair-audience')}</label>
							<input
								type="text"
								placeholder={__(
									'Enter your last name',
									'fair-audience'
								)}
								disabled
							/>
						</p>
						<p>
							<label>
								{__('Email', 'fair-audience')}{' '}
								<span className="required">*</span>
							</label>
							<input
								type="email"
								placeholder={__(
									'Enter your email',
									'fair-audience'
								)}
								disabled
							/>
						</p>

						{showInstagram && (
							<p>
								<label>
									{__('Instagram', 'fair-audience')}
								</label>
								<input
									type="text"
									placeholder={__(
										'@username',
										'fair-audience'
									)}
									disabled
								/>
							</p>
						)}

						{(questions || []).map((question, index) => (
							<QuestionPreview key={index} question={question} />
						))}

						{showKeepInformed && (
							<div className="fair-audience-audience-checkbox">
								<label>
									<input type="checkbox" disabled />
									{__(
										'Keep me informed about future events',
										'fair-audience'
									)}
								</label>
							</div>
						)}

						<div className="wp-block-button">
							<button
								type="button"
								className="wp-block-button__link wp-element-button"
								disabled
							>
								{submitButtonText ||
									__('Register', 'fair-audience')}
							</button>
						</div>
					</form>
				</div>
			</>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
