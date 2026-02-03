/**
 * Shared DateTimeControl component
 */

import { useState, useEffect } from '@wordpress/element';
import {
	DateTimePicker,
	Button,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { dateI18n } from '@wordpress/date';
import { __ } from '@wordpress/i18n';
import { getDynamicDateOptions } from './dynamicDateRegistry.js';

/**
 * Format a single datetime based on event type
 *
 * @param {string}  dateTime - ISO datetime string
 * @param {boolean} allDay   - Whether it's an all-day event
 * @return {string} Formatted date string
 */
function formatEventDate(dateTime, allDay) {
	if (!dateTime) {
		return '';
	}

	const date = new Date(dateTime);
	const day = date.getDate();
	const month = date.toLocaleString('en-US', { month: 'long' });

	if (allDay) {
		// All-day: "15 October"
		return `${day} ${month}`;
	} else {
		// Timed: "19:30, 15 October"
		const time = date
			.toLocaleTimeString('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			})
			.replace(':', ':');
		return `${time}, ${day} ${month}`;
	}
}

/**
 * A reusable date/time picker control component
 *
 * @param {Object}   props             - Component props
 * @param {string}   props.value       - Current date value (ISO format, event reference, or empty string)
 * @param {Function} props.onChange    - Callback function receiving formatted date string
 * @param {string}   props.label       - Label text for the control
 * @param {string}   props.help        - Optional help text displayed below the picker
 * @param {string}   props.eventStart  - Optional event start datetime for display
 * @param {string}   props.eventEnd    - Optional event end datetime for display
 * @param {boolean}  props.eventAllDay - Optional flag indicating if event is all-day
 * @return {JSX.Element} The DateTimeControl component
 */
export default function DateTimeControl({
	value,
	onChange,
	label,
	help,
	eventStart,
	eventEnd,
	eventAllDay = false,
}) {
	// State for dynamic date options
	const [dateOptions, setDateOptions] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedOption, setSelectedOption] = useState('custom');

	// Detect if current value looks like a dynamic date format
	const looksLikeDynamicDate = (val) => {
		return typeof val === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/i.test(val);
	};

	// Fetch dynamic date options on mount
	useEffect(() => {
		getDynamicDateOptions()
			.then((options) => {
				setDateOptions(options);
				setIsLoading(false);

				// Set initial selection based on current value
				if (value && looksLikeDynamicDate(value)) {
					setSelectedOption(value);
				} else if (value) {
					setSelectedOption('custom');
				}
			})
			.catch((error) => {
				console.error('Error loading date options:', error);
				setIsLoading(false);
			});
	}, []);

	// Update selected option if value changes externally
	useEffect(() => {
		if (value && looksLikeDynamicDate(value)) {
			setSelectedOption(value);
		} else if (value) {
			setSelectedOption('custom');
		}
	}, [value]);

	const handleTodayClick = () => {
		const today = new Date();
		const formatted = dateI18n('c', today);
		onChange(formatted);
		setSelectedOption('custom');
	};

	const handleSelectChange = (newValue) => {
		setSelectedOption(newValue);

		if (newValue === 'custom') {
			// If switching to custom, clear the value so DateTimePicker shows
			if (looksLikeDynamicDate(value)) {
				onChange('');
			}
		} else {
			// It's a dynamic date option, set it directly
			onChange(newValue);
		}
	};

	// Build combined options for dropdown
	const buildSelectOptions = () => {
		const options = [
			{
				label: __('Custom date/time', 'fair-schedule-blocks'),
				value: 'custom',
			},
		];

		// Add dynamic date options from all plugins
		if (dateOptions.length > 0) {
			dateOptions.forEach((option) => {
				options.push(option);
			});
		}

		return options;
	};

	return (
		<div style={{ marginBottom: '16px' }}>
			{isLoading ? (
				<>
					<label
						style={{
							display: 'block',
							marginBottom: '8px',
							fontWeight: 'bold',
						}}
					>
						{label}
					</label>
					<div style={{ padding: '16px', textAlign: 'center' }}>
						<Spinner />
						<p style={{ marginTop: '8px' }}>
							{__(
								'Loading date options...',
								'fair-schedule-blocks'
							)}
						</p>
					</div>
				</>
			) : (
				<>
					<SelectControl
						label={label}
						value={selectedOption}
						options={buildSelectOptions()}
						onChange={handleSelectChange}
						help={
							selectedOption !== 'custom'
								? __(
										'Using a dynamic date from plugin',
										'fair-schedule-blocks'
								  )
								: help
						}
					/>

					{selectedOption === 'custom' && (
						<>
							<DateTimePicker
								currentDate={value || null}
								onChange={(date) => {
									const formatted = date
										? dateI18n('c', date)
										: '';
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
						</>
					)}

					{selectedOption !== 'custom' &&
						value === 'fair-event:start' &&
						eventStart && (
							<p
								style={{
									fontSize: '14px',
									color: '#2c3338',
									marginTop: '8px',
									padding: '8px',
									backgroundColor: '#f0f0f1',
									borderRadius: '2px',
								}}
							>
								<strong>
									{__(
										'Resolved value:',
										'fair-schedule-blocks'
									)}
								</strong>{' '}
								{formatEventDate(eventStart, eventAllDay)}
							</p>
						)}

					{selectedOption !== 'custom' &&
						value === 'fair-event:end' &&
						eventEnd && (
							<p
								style={{
									fontSize: '14px',
									color: '#2c3338',
									marginTop: '8px',
									padding: '8px',
									backgroundColor: '#f0f0f1',
									borderRadius: '2px',
								}}
							>
								<strong>
									{__(
										'Resolved value:',
										'fair-schedule-blocks'
									)}
								</strong>{' '}
								{formatEventDate(eventEnd, eventAllDay)}
							</p>
						)}
				</>
			)}
		</div>
	);
}
