/**
 * Shared DateTimeControl component
 */

import { DateTimePicker, Button } from '@wordpress/components';
import { dateI18n } from '@wordpress/date';
import { __ } from '@wordpress/i18n';

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
	const handleTodayClick = () => {
		const today = new Date();
		const formatted = dateI18n('c', today);
		onChange(formatted);
	};

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
			<Button
				variant="secondary"
				onClick={handleTodayClick}
				style={{ marginTop: '8px' }}
			>
				{__('Today', 'fair-schedule-blocks')}
			</Button>
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
