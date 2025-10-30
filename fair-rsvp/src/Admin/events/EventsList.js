/**
 * WordPress dependencies
 */
import { __, _x } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Format event date range for display
 *
 * @param {Object} eventDate Event date object with start_datetime, end_datetime, all_day
 * @return {string} Formatted date range
 */
function formatEventDateRange(eventDate) {
	if (!eventDate || !eventDate.start_datetime) {
		return '';
	}

	const startTimestamp = new Date(eventDate.start_datetime).getTime() / 1000;

	// Check if start date is invalid
	if (isNaN(startTimestamp)) {
		return '';
	}

	const endTimestamp = eventDate.end_datetime
		? new Date(eventDate.end_datetime).getTime() / 1000
		: null;

	if (eventDate.all_day) {
		// All-day events: "1-4 October" or "31 October—2 November"
		const startDay = dateI18n('j', startTimestamp);
		const startMonth = dateI18n('F', startTimestamp);
		const startYear = dateI18n('Y', startTimestamp);

		if (endTimestamp) {
			const endDay = dateI18n('j', endTimestamp);
			const endMonth = dateI18n('F', endTimestamp);
			const endYear = dateI18n('Y', endTimestamp);

			// Same month and year
			if (startMonth === endMonth && startYear === endYear) {
				if (startDay === endDay) {
					// Single day: "15 October"
					return `${startDay} ${startMonth}`;
				}
				// Same month: "1-4 October"
				return `${startDay}–${endDay} ${startMonth}`;
			} else if (startYear === endYear) {
				// Different months, same year: "31 October—2 November"
				return `${startDay} ${startMonth}—${endDay} ${endMonth}`;
			}
			// Different years: "31 December 2024—2 January 2025"
			return `${startDay} ${startMonth} ${startYear}—${endDay} ${endMonth} ${endYear}`;
		}
		// Only start date: "15 October"
		return `${startDay} ${startMonth}`;
	}

	// Timed events: "19:30—21:30, 15 October" or "22:00 15 November—03:00 16 November"
	const startTime = dateI18n('H:i', startTimestamp);
	const startDay = dateI18n('j', startTimestamp);
	const startMonth = dateI18n('F', startTimestamp);
	const startYear = dateI18n('Y', startTimestamp);

	if (endTimestamp) {
		const endTime = dateI18n('H:i', endTimestamp);
		const endDay = dateI18n('j', endTimestamp);
		const endMonth = dateI18n('F', endTimestamp);
		const endYear = dateI18n('Y', endTimestamp);

		let startDateStr = `${startDay} ${startMonth}`;
		let endDateStr = `${endDay} ${endMonth}`;

		// Add year if different from current year
		const currentYear = dateI18n('Y');
		if (startYear !== currentYear) {
			startDateStr += ` ${startYear}`;
		}
		if (endYear !== currentYear) {
			endDateStr += ` ${endYear}`;
		}

		// Check if same day
		if (
			dateI18n('Y-m-d', startTimestamp) ===
			dateI18n('Y-m-d', endTimestamp)
		) {
			// Same day: "19:30—21:30, 15 October"
			return `${startTime}—${endTime}, ${startDateStr}`;
		}
		// Different days: "22:00 15 November—03:00 16 November"
		return `${startTime} ${startDateStr}—${endTime} ${endDateStr}`;
	}

	// Only start time: "19:30, 15 October"
	let startDateStr = `${startDay} ${startMonth}`;
	if (startYear !== dateI18n('Y')) {
		startDateStr += ` ${startYear}`;
	}
	return `${startTime}, ${startDateStr}`;
}

/**
 * Events List Component - Display all events with RSVP counts
 *
 * @return {JSX.Element} The Events List component
 */
export default function EventsList() {
	const [events, setEvents] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	// Load events on mount
	useEffect(() => {
		apiFetch({ path: '/fair-rsvp/v1/events' })
			.then((data) => {
				setEvents(data);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	}, []);

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Events with RSVPs', 'fair-rsvp')}</h1>
				<p>{__('Loading...', 'fair-rsvp')}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Events with RSVPs', 'fair-rsvp')}</h1>
				<div className="notice notice-error">
					<p>
						{__('Error loading events: ', 'fair-rsvp')}
						{error}
					</p>
				</div>
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div className="wrap">
				<h1>{__('Events with RSVPs', 'fair-rsvp')}</h1>
				<p>{__('No events with RSVPs found.', 'fair-rsvp')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Events with RSVPs', 'fair-rsvp')}</h1>

			<p>
				{events.length}{' '}
				{__(events.length === 1 ? 'event' : 'events', 'fair-rsvp')}
			</p>

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th
							scope="col"
							className="manage-column column-primary"
						>
							{__('Event', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column">
							{__('Date & Time', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Attendees', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Confirmed', 'fair-rsvp')}
						</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event) => (
						<tr key={event.event_id}>
							<td className="column-primary">
								<strong>
									<a href={event.link}>{event.title}</a>
								</strong>
								<br />
								<a
									href={`/wp-admin/admin.php?page=fair-rsvp-attendance&event_id=${event.event_id}`}
								>
									{__('Confirm Attendance', 'fair-rsvp')}
								</a>
							</td>
							<td>{formatEventDateRange(event.event_date)}</td>
							<td className="column-center">
								{event.rsvp_counts.yes}
							</td>
							<td className="column-center">
								{event.checked_in_count}
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<style>{`
				.column-center {
					text-align: center;
				}

				/* Mobile: Enable horizontal scroll to show all columns */
				@media screen and (max-width: 782px) {
					.wrap {
						overflow-x: auto;
					}
				}
			`}</style>
		</div>
	);
}
