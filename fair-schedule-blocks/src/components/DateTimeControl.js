/**
 * Shared DateTimeControl component
 */

import { DateTimePicker } from '@wordpress/components';
import { dateI18n } from '@wordpress/date';

/**
 * A reusable date/time picker control component
 *
 * @param {Object}   props          - Component props
 * @param {string}   props.value    - Current date value (ISO format or empty string)
 * @param {Function} props.onChange - Callback function receiving formatted date string
 * @param {string}   props.label    - Label text for the control
 * @param {string}   props.help     - Optional help text displayed below the picker
 * @return {JSX.Element} The DateTimeControl component
 */
export default function DateTimeControl({ value, onChange, label, help }) {
	return (
		<div style={{ marginBottom: '16px' }}>
			<label
				style={{
					display: 'block',
					marginBottom: '8px',
					fontWeight: 'bold',
				}}
			>
				{label}
			</label>
			<DateTimePicker
				currentDate={value || null}
				onChange={(date) => {
					const formatted = date ? dateI18n('c', date) : '';
					onChange(formatted);
				}}
			/>
			{help && (
				<p
					style={{
						fontSize: '12px',
						color: '#757575',
						marginTop: '8px',
					}}
				>
					{help}
				</p>
			)}
		</div>
	);
}
