/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { TextControl } from '@wordpress/components';

const TagField = ({ value, tags, onChange }) => {
	const [showSuggestions, setShowSuggestions] = useState(false);

	const filtered =
		value && tags
			? tags.filter(
					(t) =>
						t.toLowerCase().includes(value.toLowerCase()) &&
						t !== value
			  )
			: [];

	return (
		<div style={{ position: 'relative' }}>
			<TextControl
				label={__('Tag', 'fair-finance')}
				value={value || ''}
				onChange={(v) => {
					onChange(v);
					setShowSuggestions(true);
				}}
				onFocus={() => setShowSuggestions(true)}
				onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
				placeholder={__('e.g. venue, catering, travel', 'fair-finance')}
				autoComplete="off"
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			{showSuggestions && filtered.length > 0 && (
				<div
					style={{
						position: 'absolute',
						zIndex: 100,
						background: '#fff',
						border: '1px solid #ddd',
						borderRadius: '4px',
						maxHeight: '200px',
						overflowY: 'auto',
						width: '100%',
					}}
				>
					{filtered.map((tag) => (
						<div
							key={tag}
							style={{
								padding: '8px 12px',
								cursor: 'pointer',
								borderBottom: '1px solid #eee',
							}}
							onMouseDown={() => {
								onChange(tag);
								setShowSuggestions(false);
							}}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									onChange(tag);
									setShowSuggestions(false);
								}
							}}
						>
							{tag}
						</div>
					))}
				</div>
			)}
		</div>
	);
};

export default TagField;
