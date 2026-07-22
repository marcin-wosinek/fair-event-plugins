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
	Button,
	ToggleControl,
	Flex,
	FlexItem,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const CSV_COLUMNS = [
	'email',
	'name',
	'ticket_type',
	'quantity',
	'amount',
	'status',
	'mailing_opt_in',
	'date',
];

/**
 * Escape a single CSV field per RFC 4180.
 *
 * @param {*} value
 * @return {string} Escaped field
 */
function escapeCsvField(value) {
	const stringValue =
		value === null || value === undefined ? '' : String(value);
	if (/[",\r\n]/.test(stringValue)) {
		return `"${stringValue.replace(/"/g, '""')}"`;
	}
	return stringValue;
}

/**
 * Build the MailerLite-friendly CSV text for the given signups.
 *
 * @param {Array} rows
 * @return {string} CSV text
 */
function buildSignupsCsv(rows) {
	const lines = [CSV_COLUMNS.join(',')];
	rows.forEach((s) => {
		const row = [
			s.email,
			s.name,
			s.ticket_type_id || '',
			s.quantity,
			s.amount,
			s.status,
			s.mailing_opt_in ? 'yes' : 'no',
			s.created_at,
		];
		lines.push(row.map(escapeCsvField).join(','));
	});
	return lines.join('\r\n');
}

/**
 * Trigger a client-side download of the given text as a file.
 *
 * @param {string} text
 * @param {string} filename
 */
function downloadTextFile(text, filename) {
	const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export default function EventSignups({ eventDateId }) {
	const [signups, setSignups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [mailingOnly, setMailingOnly] = useState(false);

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

	const visibleSignups = mailingOnly
		? signups.filter((s) => s.mailing_opt_in)
		: signups;

	const handleDownloadCsv = () => {
		const csv = buildSignupsCsv(visibleSignups);
		downloadTextFile(csv, `signups-event-${eventDateId}.csv`);
	};

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Ticket Signups', 'fair-events')}</h2>
				<Flex justify="flex-end" gap={2}>
					<FlexItem>
						<ToggleControl
							__nextHasNoMarginBottom
							label={__('Mailing opt-ins only', 'fair-events')}
							checked={mailingOnly}
							onChange={setMailingOnly}
						/>
					</FlexItem>
					<FlexItem>
						<Button
							variant="secondary"
							onClick={handleDownloadCsv}
							disabled={visibleSignups.length === 0}
						>
							{__('Download CSV', 'fair-events')}
						</Button>
					</FlexItem>
				</Flex>
			</CardHeader>
			<CardBody>
				{visibleSignups.length === 0 ? (
					<p>
						{signups.length === 0
							? __('No signups yet.', 'fair-events')
							: __(
									'Nothing to export — no signups match the current filter.',
									'fair-events'
							  )}
					</p>
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
							{visibleSignups.map((s) => (
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
