/**
 * Quick Event Modal Component
 *
 * Modal for creating standalone events from the calendar.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Modal,
	TextControl,
	CheckboxControl,
	SelectControl,
	Button,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate } from 'fair-events-shared';

export default function QuickEventModal({ date, onClose, onSuccess }) {
	const dateStr = formatLocalDate(date);

	const [title, setTitle] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [startDate, setStartDate] = useState(dateStr);
	const [startTime, setStartTime] = useState('10:00');
	const [endDate, setEndDate] = useState(dateStr);
	const [endTime, setEndTime] = useState('12:00');
	const [venueId, setVenueId] = useState('');
	const [venues, setVenues] = useState([]);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/venues' })
			.then((data) => setVenues(data))
			.catch(() => {
				// Venues are optional, ignore errors.
			});
	}, []);

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		const startDatetime = allDay
			? `${startDate} 00:00:00`
			: `${startDate} ${startTime}:00`;

		const endDatetime = allDay
			? `${endDate} 00:00:00`
			: `${endDate} ${endTime}:00`;

		try {
			const eventDate = await apiFetch({
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title,
					start_datetime: startDatetime,
					end_datetime: endDatetime,
					all_day: allDay,
					venue_id: venueId ? parseInt(venueId, 10) : undefined,
					link_type: 'none',
				},
			});

			onSuccess(eventDate);
		} catch (err) {
			setError(
				err.message || __('Failed to create event.', 'fair-events')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

	return (
		<Modal
			title={__('Quick Add Event', 'fair-events')}
			onRequestClose={onClose}
			style={{ maxWidth: '480px' }}
		>
			<form onSubmit={handleSubmit}>
				<VStack spacing={4}>
					{error && (
						<div className="notice notice-error inline">
							<p>{error}</p>
						</div>
					)}

					<TextControl
						label={__('Title', 'fair-events')}
						value={title}
						onChange={setTitle}
						required
						autoFocus
					/>

					<CheckboxControl
						label={__('All day', 'fair-events')}
						checked={allDay}
						onChange={setAllDay}
					/>

					{allDay ? (
						<HStack spacing={4} alignment="top">
							<TextControl
								label={__('Start date', 'fair-events')}
								type="date"
								value={startDate}
								onChange={setStartDate}
								required
							/>
							<TextControl
								label={__('End date', 'fair-events')}
								type="date"
								value={endDate}
								onChange={setEndDate}
								required
							/>
						</HStack>
					) : (
						<>
							<HStack spacing={4} alignment="top">
								<TextControl
									label={__('Start date', 'fair-events')}
									type="date"
									value={startDate}
									onChange={setStartDate}
									required
								/>
								<TextControl
									label={__('Start time', 'fair-events')}
									type="time"
									value={startTime}
									onChange={setStartTime}
									required
								/>
							</HStack>
							<HStack spacing={4} alignment="top">
								<TextControl
									label={__('End date', 'fair-events')}
									type="date"
									value={endDate}
									onChange={setEndDate}
									required
								/>
								<TextControl
									label={__('End time', 'fair-events')}
									type="time"
									value={endTime}
									onChange={setEndTime}
									required
								/>
							</HStack>
						</>
					)}

					<SelectControl
						label={__('Venue', 'fair-events')}
						value={venueId}
						options={venueOptions}
						onChange={setVenueId}
					/>

					<HStack justify="flex-end" spacing={2}>
						<Button
							variant="tertiary"
							onClick={onClose}
							disabled={isSaving}
						>
							{__('Cancel', 'fair-events')}
						</Button>
						<Button
							variant="primary"
							type="submit"
							isBusy={isSaving}
							disabled={isSaving || !title}
						>
							{__('Create Event', 'fair-events')}
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
}
