import { Button, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

/**
 * Reusable options list editor for select/multiselect question blocks.
 *
 * @param {Object}   props
 * @param {string[]} props.options    Current options array.
 * @param {Function} props.onChange   Callback with updated options array.
 */
export default function OptionsEditor({ options, onChange }) {
	const addOption = () => {
		onChange([...options, '']);
	};

	const updateOption = (index, value) => {
		const updated = [...options];
		updated[index] = value;
		onChange(updated);
	};

	const removeOption = (index) => {
		onChange(options.filter((_, i) => i !== index));
	};

	return (
		<div className="fair-form-options-editor">
			{options.map((option, index) => (
				<div key={index} className="fair-form-options-editor-row">
					<TextControl
						value={option}
						onChange={(value) => updateOption(index, value)}
						placeholder={
							__('Option', 'fair-audience') + ' ' + (index + 1)
						}
					/>
					<Button
						icon="no-alt"
						label={__('Remove option', 'fair-audience')}
						isSmall
						isDestructive
						onClick={() => removeOption(index)}
					/>
				</div>
			))}
			<Button variant="secondary" isSmall onClick={addOption}>
				{__('Add option', 'fair-audience')}
			</Button>
		</div>
	);
}
