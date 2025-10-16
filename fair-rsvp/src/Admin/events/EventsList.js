/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

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
						<th scope="col" className="manage-column column-center">
							{__('Yes', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Maybe', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('No', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Pending', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Cancelled', 'fair-rsvp')}
						</th>
						<th scope="col" className="manage-column column-center">
							{__('Total RSVPs', 'fair-rsvp')}
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
							</td>
							<td className="column-center">
								{event.rsvp_counts.yes}
							</td>
							<td className="column-center">
								{event.rsvp_counts.maybe}
							</td>
							<td className="column-center">
								{event.rsvp_counts.no}
							</td>
							<td className="column-center">
								{event.rsvp_counts.pending}
							</td>
							<td className="column-center">
								{event.rsvp_counts.cancelled}
							</td>
							<td className="column-center">
								<strong>{event.total_rsvps}</strong>
							</td>
						</tr>
					))}
				</tbody>
			</table>

			<style>{`
				.column-center {
					text-align: center;
				}
			`}</style>
		</div>
	);
}
