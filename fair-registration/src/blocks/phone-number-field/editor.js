import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPhone } from '@fortawesome/free-solid-svg-icons';

registerBlockType('fair-registration/phone-number-field', {
	icon: <FontAwesomeIcon icon={faPhone} />,
	edit: ({ attributes, setAttributes, context }) => {
		const { label, placeholder, required, fieldId, pattern } = attributes;
		const { 'fair-registration/formId': formId } = context;

		const blockProps = useBlockProps({
			className: 'fair-registration-phone-number-field-editor',
		});

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
							label={__('Placeholder Text', 'fair-registration')}
							value={placeholder}
							onChange={(value) =>
								setAttributes({ placeholder: value })
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
							label={__('Pattern (Regex)', 'fair-registration')}
							value={pattern}
							onChange={(value) =>
								setAttributes({ pattern: value })
							}
							help={__(
								'Optional regex pattern for validation',
								'fair-registration'
							)}
						/>
						<ToggleControl
							label={__('Required Field', 'fair-registration')}
							checked={required}
							onChange={(value) =>
								setAttributes({ required: value })
							}
						/>
					</PanelBody>
				</InspectorControls>

				<div className="fair-registration-field">
					<label className="fair-registration-field-label">
						{label}
						{required && <span className="required">*</span>}
					</label>
					<input
						type="tel"
						className="fair-registration-field-input"
						placeholder={placeholder}
						disabled
					/>
				</div>
			</div>
		);
	},
	save: () => {
		return null;
	},
});
