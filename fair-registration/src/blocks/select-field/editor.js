import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	Button,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faChevronDown,
	faPlus,
	faMinus,
} from '@fortawesome/free-solid-svg-icons';

registerBlockType('fair-registration/select-field', {
	icon: <FontAwesomeIcon icon={faChevronDown} />,
	edit: ({ attributes, setAttributes, context }) => {
		const { label, required, fieldId, options, placeholder } = attributes;
		const { 'fair-registration/formId': formId } = context;

		const blockProps = useBlockProps({
			className: 'fair-registration-select-field-editor',
		});

		const updateOption = (index, key, value) => {
			const newOptions = [...options];
			newOptions[index] = { ...newOptions[index], [key]: value };
			setAttributes({ options: newOptions });
		};

		const addOption = () => {
			setAttributes({
				options: [
					...options,
					{
						label: `Option ${options.length + 1}`,
						value: `option${options.length + 1}`,
					},
				],
			});
		};

		const removeOption = (index) => {
			if (options.length > 1) {
				setAttributes({
					options: options.filter((_, i) => i !== index),
				});
			}
		};

		return (
			<div {...blockProps}>
				<InspectorControls>
					<PanelBody
						title={__('Field Settings', 'fair-registration')}
					>
						<TextControl
							label={__('Field Label', 'fair-registration')}
							value={label}
							onChange={(value) =>
								setAttributes({ label: value })
							}
						/>
						<TextControl
							label={__('Field ID', 'fair-registration')}
							value={fieldId}
							onChange={(value) =>
								setAttributes({ fieldId: value })
							}
							help={__(
								'Unique identifier for this field',
								'fair-registration'
							)}
						/>
						<TextControl
							label={__('Placeholder Text', 'fair-registration')}
							value={placeholder}
							onChange={(value) =>
								setAttributes({ placeholder: value })
							}
						/>
						<ToggleControl
							label={__('Required Field', 'fair-registration')}
							checked={required}
							onChange={(value) =>
								setAttributes({ required: value })
							}
						/>
					</PanelBody>

					<PanelBody title={__('Options', 'fair-registration')}>
						{options.map((option, index) => (
							<div
								key={index}
								style={{
									marginBottom: '15px',
									padding: '10px',
									border: '1px solid #ddd',
								}}
							>
								<TextControl
									label={__(
										'Option Label',
										'fair-registration'
									)}
									value={option.label}
									onChange={(value) =>
										updateOption(index, 'label', value)
									}
								/>
								<TextControl
									label={__(
										'Option Value',
										'fair-registration'
									)}
									value={option.value}
									onChange={(value) =>
										updateOption(index, 'value', value)
									}
								/>
								{options.length > 1 && (
									<Button
										variant="secondary"
										isDestructive
										onClick={() => removeOption(index)}
									>
										<FontAwesomeIcon icon={faMinus} />{' '}
										{__('Remove', 'fair-registration')}
									</Button>
								)}
							</div>
						))}
						<Button variant="primary" onClick={addOption}>
							<FontAwesomeIcon icon={faPlus} />{' '}
							{__('Add Option', 'fair-registration')}
						</Button>
					</PanelBody>
				</InspectorControls>

				<div className="fair-registration-field">
					<label className="fair-registration-field-label">
						{label}
						{required && <span className="required">*</span>}
					</label>
					<select className="fair-registration-field-input" disabled>
						<option value="">{placeholder}</option>
						{options.map((option, index) => (
							<option key={index} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
			</div>
		);
	},
	save: () => {
		return null;
	},
});
