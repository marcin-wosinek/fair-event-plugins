/**
 * Event Signups Component
 *
 * Read-only list of get-tickets signups for an event date.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function EventSignups({ eventDateId }) {
	const [signups, setSignups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		apiFetch({
			path: `/fair-events/v1/get-tickets?event_date=${eventDateId}`,
		})
			.then((data) => {
				setSignups(data);
				setLoading(false);
			})
			.catch((err) => {
				setError(
					err.message || __('Failed to load signups.', 'fair-events')
				);
				setLoading(false);
			});
	}, [eventDateId]);

	if (loading) {
		return <Spinner />;
	}

	if (error) {
		return <Notice status="error">{error}</Notice>;
	}

	const headers = [
		__('Name', 'fair-events'),
		__('Email', 'fair-events'),
		__('Ticket Type', 'fair-events'),
		__('Qty', 'fair-events'),
		__('Amount', 'fair-events'),
		__('Status', 'fair-events'),
		__('Mailing', 'fair-events'),
		__('Date', 'fair-events'),
	];

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Ticket Signups', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				{signups.length === 0 ? (
					<p>{__('No signups yet.', 'fair-events')}</p>
				) : (
					<table
						style={{ width: '100%', borderCollapse: 'collapse' }}
					>
						<thead>
							<tr>
								{headers.map((h) => (
									<th
										key={h}
										style={{
											textAlign: 'left',
											padding: '8px',
											borderBottom: '1px solid #ddd',
										}}
									>
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{signups.map((s) => (
								<tr key={s.id}>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.name}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.email}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.ticket_type_id || '—'}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.quantity}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.amount}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.status}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.mailing_opt_in
											? __('Yes', 'fair-events')
											: __('No', 'fair-events')}
									</td>
									<td
										style={{
											padding: '8px',
											borderBottom: '1px solid #eee',
										}}
									>
										{s.created_at}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</CardBody>
		</Card>
	);
}
