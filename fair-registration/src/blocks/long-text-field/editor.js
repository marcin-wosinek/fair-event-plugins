import './editor.css';

import { registerBlockType } from '@wordpress/blocks';
import { InspectorControls, useBlockProps } from '@wordpress/block-editor';
import {
	PanelBody,
	TextControl,
	ToggleControl,
	RangeControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAlignLeft } from '@fortawesome/free-solid-svg-icons';

registerBlockType('fair-registration/long-text-field', {
	icon: <FontAwesomeIcon icon={faAlignLeft} />,
	edit: ({ attributes, setAttributes, context }) => {
		const { label, placeholder, required, fieldId, rows, maxLength } =
			attributes;
		const { 'fair-registration/formId': formId } = context;

		const blockProps = useBlockProps({
			className: 'fair-registration-long-text-field-editor',
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
						<RangeControl
							label={__('Rows', 'fair-registration')}
							value={rows}
							onChange={(value) => setAttributes({ rows: value })}
							min={2}
							max={10}
						/>
						<RangeControl
							label={__('Maximum Length', 'fair-registration')}
							value={maxLength}
							onChange={(value) =>
								setAttributes({ maxLength: value })
							}
							min={100}
							max={5000}
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
					<textarea
						className="fair-registration-field-input"
						placeholder={placeholder}
						rows={rows}
						maxLength={maxLength}
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
