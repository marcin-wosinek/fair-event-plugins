import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Spinner } from '@wordpress/components';
import { formatDateOrFallback } from 'fair-events-shared';

export default function EventsList() {
	const [events, setEvents] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		apiFetch({ path: '/fair-audience/v1/events' })
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
				<h1>{__('Events', 'fair-audience')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Events', 'fair-audience')}</h1>
				<div className="notice notice-error">
					<p>{__('Error: ', 'fair-audience') + error}</p>
				</div>
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div className="wrap">
				<h1>{__('Events', 'fair-audience')}</h1>
				<p>{__('No events found.', 'fair-audience')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Events', 'fair-audience')}</h1>

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th>{__('Event', 'fair-audience')}</th>
						<th>{__('Date', 'fair-audience')}</th>
						<th>{__('Interested', 'fair-audience')}</th>
						<th>{__('Signed Up', 'fair-audience')}</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event) => (
						<tr key={event.event_id}>
							<td>
								<strong>
									<a href={event.link}>{event.title}</a>
								</strong>
								<br />
								<a
									href={`/wp-admin/admin.php?page=fair-audience-event-participants&event_id=${event.event_id}`}
								>
									{__('View Participants', 'fair-audience')}
								</a>
							</td>
							<td>
								{event.event_date
									? formatDateOrFallback(event.event_date)
									: '—'}
							</td>
							<td>{event.participant_counts.interested || 0}</td>
							<td>{event.participant_counts.signed_up || 0}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
