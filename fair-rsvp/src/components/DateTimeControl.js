/**
 * Shared DateTimeControl component
 */

import { useState, useEffect } from '@wordpress/element';
import {
	DateTimePicker,
	Button,
	RadioControl,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { dateI18n } from '@wordpress/date';
import { __ } from '@wordpress/i18n';
import { getDynamicDateOptions } from 'fair-events-shared';

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

	// Detect if current value looks like a dynamic date format
	// Uses simple pattern matching since options might not be loaded yet
	const looksLikeDynamicDate = (val) => {
		return typeof val === 'string' && /^[a-z0-9-]+:[a-z0-9-]+$/i.test(val);
	};

	// Initialize mode based on current value pattern
	const [mode, setMode] = useState(
		looksLikeDynamicDate(value) ? 'event' : 'custom'
	);

	// Fetch dynamic date options on mount
	useEffect(() => {
		getDynamicDateOptions()
			.then((options) => {
				setDateOptions(options);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error('Error loading date options:', error);
				setIsLoading(false);
			});
	}, []);

	// Update mode if value changes externally
	useEffect(() => {
		setMode(looksLikeDynamicDate(value) ? 'event' : 'custom');
	}, [value]);

	const handleTodayClick = () => {
		const today = new Date();
		const formatted = dateI18n('c', today);
		onChange(formatted);
	};

	const handleModeChange = (newMode) => {
		setMode(newMode);
		if (newMode === 'event') {
			// Switch to event mode, default to first available option
			if (dateOptions.length > 0) {
				onChange(dateOptions[0].value);
			}
		} else {
			// Switch to custom mode, clear value
			onChange('');
		}
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

			<RadioControl
				selected={mode}
				options={[
					{
						label: __('Custom date/time', 'fair-schedule-blocks'),
						value: 'custom',
					},
					{
						label: __('Read date from', 'fair-schedule-blocks'),
						value: 'event',
					},
				]}
				onChange={handleModeChange}
			/>

			{mode === 'custom' ? (
				<>
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
				</>
			) : (
				<>
					{isLoading ? (
						<div style={{ padding: '16px', textAlign: 'center' }}>
							<Spinner />
							<p style={{ marginTop: '8px' }}>
								{__(
									'Loading date options...',
									'fair-schedule-blocks'
								)}
							</p>
						</div>
					) : dateOptions.length === 0 ? (
						<p
							style={{
								padding: '12px',
								backgroundColor: '#f0f0f1',
								borderRadius: '2px',
								color: '#757575',
							}}
						>
							{__(
								'No dynamic date options available.',
								'fair-schedule-blocks'
							)}
						</p>
					) : (
						<>
							<SelectControl
								label={__('Event date', 'fair-schedule-blocks')}
								value={value}
								options={dateOptions}
								onChange={onChange}
							/>
							{(() => {
								// For backward compatibility: check if it's fair-event format
								if (
									value === 'fair-event:start' ||
									value === 'fair-event:end'
								) {
									const resolvedDate =
										value === 'fair-event:start'
											? eventStart
											: eventEnd;

									if (resolvedDate) {
										const formattedDate = formatEventDate(
											resolvedDate,
											eventAllDay
										);
										return (
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
														'Current value:',
														'fair-schedule-blocks'
													)}
												</strong>{' '}
												{formattedDate}
											</p>
										);
									}
								}
								return null;
							})()}
						</>
					)}
				</>
			)}

			{help && mode === 'custom' && (
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

			{mode === 'event' && (
				<p
					style={{
						fontSize: '12px',
						color: '#757575',
						marginTop: '8px',
					}}
				>
					{__(
						"Uses the event's start or end date automatically.",
						'fair-schedule-blocks'
					)}
				</p>
			)}
		</div>
	);
}
