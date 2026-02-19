/**
 * WordPress dependencies
 */
import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	Button,
	Spinner,
	Notice,
	TextControl,
	CheckboxControl,
	SelectControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useDispatch } from '@wordpress/data';

/**
 * Fair Events Shared dependencies
 */
import { DurationOptions, calculateDuration } from 'fair-events-shared';

/**
 * Internal dependencies
 */
import { STORE_NAME } from './store.js';

/**
 * EventEditForm component
 *
 * Loads event data via REST API, provides inline editing, saves via REST API,
 * and dispatches to the custom store for block live preview.
 */
export default function EventEditForm({
	eventDateId,
	manageEventUrl,
	postId,
	postType,
}) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [venues, setVenues] = useState([]);

	// Form state.
	const [allDay, setAllDay] = useState(false);
	const [startDate, setStartDate] = useState('');
	const [startTime, setStartTime] = useState('');
	const [endDate, setEndDate] = useState('');
	const [endTime, setEndTime] = useState('');
	const [venueId, setVenueId] = useState('');

	// Recurrence state.
	const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
	const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
	const [recurrenceEndType, setRecurrenceEndType] = useState('count');
	const [recurrenceCount, setRecurrenceCount] = useState(10);
	const [recurrenceUntil, setRecurrenceUntil] = useState('');

	const { setEventData } = useDispatch(STORE_NAME);

	useEffect(() => {
		loadEventDate();
		loadVenues();
	}, [eventDateId]);

	const loadEventDate = async () => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
			});
			populateForm(data);
			setEventData(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load event data.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const loadVenues = async () => {
		try {
			const data = await apiFetch({ path: '/fair-events/v1/venues' });
			setVenues(data);
		} catch {
			// Venues are optional.
		}
	};

	const populateForm = (data) => {
		setAllDay(data.all_day || false);
		setVenueId(data.venue_id ? String(data.venue_id) : '');

		if (data.start_datetime) {
			const [sDate, sTime] = data.start_datetime.split(' ');
			setStartDate(sDate || '');
			setStartTime(sTime ? sTime.substring(0, 5) : '');
		} else {
			setStartDate('');
			setStartTime('');
		}
		if (data.end_datetime) {
			const [eDate, eTime] = data.end_datetime.split(' ');
			setEndDate(eDate || '');
			setEndTime(eTime ? eTime.substring(0, 5) : '');
		} else {
			setEndDate('');
			setEndTime('');
		}

		if (data.rrule) {
			setRecurrenceEnabled(true);
			parseRRule(data.rrule);
		} else {
			setRecurrenceEnabled(false);
		}
	};

	// Duration options.
	const timedDurationOptions = useMemo(
		() =>
			new DurationOptions({
				values: [30, 60, 90, 120, 150, 180, 240, 360, 480],
				unit: 'minutes',
				textDomain: 'fair-events',
			}),
		[]
	);

	const allDayDurationOptions = useMemo(
		() =>
			new DurationOptions({
				values: [1, 2, 3, 4, 5, 6, 7],
				unit: 'days',
				textDomain: 'fair-events',
			}),
		[]
	);

	const getCurrentDuration = () => {
		if (allDay) {
			if (!startDate || !endDate) return 'other';
			const start = new Date(startDate);
			const end = new Date(endDate);
			const diffDays =
				Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
			return allDayDurationOptions.getCurrentSelection(diffDays);
		}
		if (!startDate || !startTime || !endDate || !endTime) return 'other';
		const startIso = `${startDate}T${startTime}`;
		const endIso = `${endDate}T${endTime}`;
		const minutes = calculateDuration(startIso, endIso);
		if (minutes === null) return 'other';
		return timedDurationOptions.getCurrentSelection(minutes);
	};

	const durationValue = getCurrentDuration();

	const durationOptions = allDay
		? allDayDurationOptions.getDurationOptions()
		: timedDurationOptions.getDurationOptions();

	const handleDurationChange = (value) => {
		if (value === 'other' || !startDate) return;
		if (allDay) {
			const days = parseInt(value, 10);
			const start = new Date(startDate);
			const end = new Date(start);
			end.setDate(start.getDate() + days - 1);
			const year = end.getFullYear();
			const month = String(end.getMonth() + 1).padStart(2, '0');
			const day = String(end.getDate()).padStart(2, '0');
			setEndDate(`${year}-${month}-${day}`);
		} else {
			if (!startTime) return;
			const minutes = parseInt(value, 10);
			const start = new Date(`${startDate}T${startTime}`);
			const end = new Date(start.getTime() + minutes * 60000);
			const year = end.getFullYear();
			const month = String(end.getMonth() + 1).padStart(2, '0');
			const day = String(end.getDate()).padStart(2, '0');
			const hours = String(end.getHours()).padStart(2, '0');
			const mins = String(end.getMinutes()).padStart(2, '0');
			setEndDate(`${year}-${month}-${day}`);
			setEndTime(`${hours}:${mins}`);
		}
	};

	// Recurrence helpers.
	const parseRRule = (rrule) => {
		const parts = {};
		rrule.split(';').forEach((part) => {
			const [key, val] = part.split('=');
			parts[key] = val;
		});

		const freq = parts.FREQ || 'WEEKLY';
		const interval = parseInt(parts.INTERVAL || '1', 10);

		if (freq === 'DAILY') {
			setRecurrenceFrequency('daily');
		} else if (freq === 'WEEKLY' && interval === 2) {
			setRecurrenceFrequency('biweekly');
		} else if (freq === 'WEEKLY') {
			setRecurrenceFrequency('weekly');
		} else if (freq === 'MONTHLY') {
			setRecurrenceFrequency('monthly');
		}

		if (parts.COUNT) {
			setRecurrenceEndType('count');
			setRecurrenceCount(parseInt(parts.COUNT, 10));
		} else if (parts.UNTIL) {
			setRecurrenceEndType('until');
			const u = parts.UNTIL;
			setRecurrenceUntil(
				`${u.substring(0, 4)}-${u.substring(4, 6)}-${u.substring(6, 8)}`
			);
		} else {
			setRecurrenceEndType('count');
			setRecurrenceCount(10);
		}
	};

	const buildRRule = () => {
		if (!recurrenceEnabled) return null;

		let freq = 'WEEKLY';
		let interval = 1;

		switch (recurrenceFrequency) {
			case 'daily':
				freq = 'DAILY';
				break;
			case 'weekly':
				freq = 'WEEKLY';
				break;
			case 'biweekly':
				freq = 'WEEKLY';
				interval = 2;
				break;
			case 'monthly':
				freq = 'MONTHLY';
				break;
		}

		const ruleParts = [`FREQ=${freq}`];
		if (interval > 1) {
			ruleParts.push(`INTERVAL=${interval}`);
		}
		if (recurrenceEndType === 'count' && recurrenceCount) {
			ruleParts.push(`COUNT=${recurrenceCount}`);
		} else if (recurrenceEndType === 'until' && recurrenceUntil) {
			ruleParts.push(`UNTIL=${recurrenceUntil.replace(/-/g, '')}`);
		}

		return ruleParts.join(';');
	};

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		const startDatetime = allDay
			? `${startDate} 00:00:00`
			: `${startDate} ${startTime}:00`;

		const endDatetime =
			endDate && (allDay || endTime)
				? allDay
					? `${endDate} 00:00:00`
					: `${endDate} ${endTime}:00`
				: null;

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data: {
					start_datetime: startDate ? startDatetime : null,
					end_datetime: endDatetime,
					all_day: allDay,
					venue_id: venueId ? parseInt(venueId, 10) : null,
					rrule: buildRRule(),
				},
			});
			setEventData(updated);
			setSuccess(__('Event saved.', 'fair-events'));
		} catch (err) {
			setError(err.message || __('Failed to save event.', 'fair-events'));
		} finally {
			setSaving(false);
		}
	};

	// Dispatch store updates on field changes for live preview.
	useEffect(() => {
		if (loading) return;

		const startDatetime =
			startDate && (allDay || startTime)
				? allDay
					? `${startDate} 00:00:00`
					: `${startDate} ${startTime}:00`
				: null;

		const endDatetime =
			endDate && (allDay || endTime)
				? allDay
					? `${endDate} 00:00:00`
					: `${endDate} ${endTime}:00`
				: null;

		setEventData({
			id: eventDateId,
			start_datetime: startDatetime,
			end_datetime: endDatetime,
			all_day: allDay,
			venue_id: venueId ? parseInt(venueId, 10) : null,
		});
	}, [startDate, startTime, endDate, endTime, allDay, venueId]);

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

	if (loading) {
		return <Spinner />;
	}

	return (
		<VStack spacing={3}>
			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			<CheckboxControl
				label={__('All day', 'fair-events')}
				checked={allDay}
				onChange={setAllDay}
			/>

			<TextControl
				label={__('Start date', 'fair-events')}
				type="date"
				value={startDate}
				onChange={setStartDate}
			/>

			{!allDay && (
				<TextControl
					label={__('Start time', 'fair-events')}
					type="time"
					value={startTime}
					onChange={setStartTime}
				/>
			)}

			<SelectControl
				label={__('Event length', 'fair-events')}
				value={String(durationValue)}
				options={durationOptions.map((opt) => ({
					label: opt.label,
					value: String(opt.value),
				}))}
				onChange={handleDurationChange}
			/>

			<TextControl
				label={__('End date', 'fair-events')}
				type="date"
				value={endDate}
				onChange={setEndDate}
			/>

			{!allDay && (
				<TextControl
					label={__('End time', 'fair-events')}
					type="time"
					value={endTime}
					onChange={setEndTime}
				/>
			)}

			<SelectControl
				label={__('Venue', 'fair-events')}
				value={venueId}
				options={venueOptions}
				onChange={setVenueId}
			/>

			<CheckboxControl
				label={__('Repeat this event', 'fair-events')}
				checked={recurrenceEnabled}
				onChange={setRecurrenceEnabled}
			/>

			{recurrenceEnabled && (
				<VStack spacing={2}>
					<SelectControl
						label={__('Frequency', 'fair-events')}
						value={recurrenceFrequency}
						options={[
							{
								label: __('Daily', 'fair-events'),
								value: 'daily',
							},
							{
								label: __('Weekly', 'fair-events'),
								value: 'weekly',
							},
							{
								label: __('Biweekly', 'fair-events'),
								value: 'biweekly',
							},
							{
								label: __('Monthly', 'fair-events'),
								value: 'monthly',
							},
						]}
						onChange={setRecurrenceFrequency}
					/>
					<SelectControl
						label={__('Ends', 'fair-events')}
						value={recurrenceEndType}
						options={[
							{
								label: __(
									'After number of occurrences',
									'fair-events'
								),
								value: 'count',
							},
							{
								label: __('On a specific date', 'fair-events'),
								value: 'until',
							},
						]}
						onChange={setRecurrenceEndType}
					/>
					{recurrenceEndType === 'count' && (
						<TextControl
							label={__('Number of occurrences', 'fair-events')}
							type="number"
							value={String(recurrenceCount)}
							onChange={(val) =>
								setRecurrenceCount(parseInt(val, 10) || 1)
							}
							min={1}
							max={365}
						/>
					)}
					{recurrenceEndType === 'until' && (
						<TextControl
							label={__('End date', 'fair-events')}
							type="date"
							value={recurrenceUntil}
							onChange={setRecurrenceUntil}
						/>
					)}
				</VStack>
			)}

			<Button
				variant="primary"
				onClick={handleSave}
				isBusy={saving}
				disabled={saving}
				style={{
					width: '100%',
					justifyContent: 'center',
				}}
			>
				{__('Save Event', 'fair-events')}
			</Button>

			{manageEventUrl && (
				<Button
					variant="secondary"
					href={manageEventUrl}
					style={{
						width: '100%',
						justifyContent: 'center',
					}}
				>
					{__('Edit Full Details', 'fair-events')}
				</Button>
			)}
		</VStack>
	);
}
