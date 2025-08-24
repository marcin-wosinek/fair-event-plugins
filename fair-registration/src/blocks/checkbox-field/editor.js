import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, TextControl, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';

registerBlockType('fair-registration/checkbox-field', {
	icon: <FontAwesomeIcon icon={faCheck} />,
	edit: ({ attributes, setAttributes, context }) => {
		const { label, required, fieldId, checked, value } = attributes;
		const { 'fair-registration/formId': formId } = context;

		const blockProps = useBlockProps({
			className: 'fair-registration-checkbox-field-editor',
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
							label={__('Value', 'fair-registration')}
							value={value}
							onChange={(value) =>
								setAttributes({ value: value })
							}
							help={__(
								'Value sent when checkbox is checked',
								'fair-registration'
							)}
						/>
						<ToggleControl
							label={__('Default Checked', 'fair-registration')}
							checked={checked}
							onChange={(value) =>
								setAttributes({ checked: value })
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
				</InspectorControls>

				<div className="fair-registration-field">
					<label className="fair-registration-field-label fair-registration-checkbox-label">
						<input
							type="checkbox"
							className="fair-registration-field-checkbox"
							checked={checked}
							disabled
						/>
						<FontAwesomeIcon icon={faCheck} />
						{label}
						{required && <span className="required">*</span>}
					</label>
				</div>
			</div>
		);
	},
	save: () => {
		return null;
	},
});
