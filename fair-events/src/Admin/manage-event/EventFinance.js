/**
 * Event Finance Component
 *
 * Shows financial totals and recent entries for the current event date.
 * Only rendered when fair-payment plugin is active.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const formatAmount = (amount) => {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'EUR',
	}).format(amount);
};

const renderParticipant = (tx) => {
	const participant = tx.participant;
	if (participant?.name && participant?.admin_url) {
		return <a href={participant.admin_url}>{participant.name}</a>;
	}
	if (participant?.name) {
		return participant.name;
	}
	if (tx.user_name) {
		return tx.user_name;
	}
	return <em>-</em>;
};

export default function EventFinance({ eventDateId, entriesUrl }) {
	const [totals, setTotals] = useState(null);
	const [entries, setEntries] = useState([]);
	const [transactions, setTransactions] = useState([]);
	const [failedTransactions, setFailedTransactions] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		loadData();
	}, [eventDateId]);

	const loadData = async () => {
		setLoading(true);
		setError(null);

		try {
			const [
				totalsData,
				entriesData,
				transactionsData,
				failedData,
				canceledData,
				expiredData,
			] = await Promise.all([
				apiFetch({
					path: `/fair-payment/v1/financial-entries/totals?event_date_id=${eventDateId}`,
				}),
				apiFetch({
					path: `/fair-payment/v1/financial-entries?event_date_id=${eventDateId}&per_page=10`,
				}),
				apiFetch({
					path: `/fair-payment/v1/transactions?event_date_id=${eventDateId}&status=paid&mode=live&per_page=100`,
				}),
				apiFetch({
					path: `/fair-payment/v1/transactions?event_date_id=${eventDateId}&status=failed&mode=live&per_page=100`,
				}),
				apiFetch({
					path: `/fair-payment/v1/transactions?event_date_id=${eventDateId}&status=canceled&mode=live&per_page=100`,
				}),
				apiFetch({
					path: `/fair-payment/v1/transactions?event_date_id=${eventDateId}&status=expired&mode=live&per_page=100`,
				}),
			]);

			const paidTransactions = transactionsData.transactions || [];
			const transactionIncome = paidTransactions.reduce(
				(sum, tx) => sum + (tx.amount || 0),
				0
			);

			const failed = [
				...(failedData.transactions || []),
				...(canceledData.transactions || []),
				...(expiredData.transactions || []),
			].sort((a, b) =>
				(b.created_at || '').localeCompare(a.created_at || '')
			);

			setTotals({
				...totalsData,
				total_income:
					(totalsData.total_income || 0) + transactionIncome,
				balance: (totalsData.balance || 0) + transactionIncome,
			});
			setEntries(entriesData.entries || []);
			setTransactions(paidTransactions);
			setFailedTransactions(failed);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load financial data.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const viewAllUrl = `${entriesUrl}&event_date_id=${eventDateId}`;

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Finance', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				{loading && (
					<div style={{ textAlign: 'center', padding: '20px' }}>
						<Spinner />
					</div>
				)}

				{error && (
					<Notice
						status="error"
						isDismissible
						onRemove={() => setError(null)}
					>
						{error}
					</Notice>
				)}

				{!loading && !error && (
					<VStack spacing={4}>
						{totals && (
							<HStack justify="space-around">
								<div style={{ textAlign: 'center' }}>
									<div
										style={{
											fontSize: '24px',
											fontWeight: 'bold',
											color: '#d63638',
										}}
									>
										{formatAmount(totals.total_cost)}
									</div>
									<div style={{ color: '#666' }}>
										{__('Total Costs', 'fair-events')}
									</div>
								</div>
								<div style={{ textAlign: 'center' }}>
									<div
										style={{
											fontSize: '24px',
											fontWeight: 'bold',
											color: '#007017',
										}}
									>
										{formatAmount(totals.total_income)}
									</div>
									<div style={{ color: '#666' }}>
										{__('Total Income', 'fair-events')}
									</div>
								</div>
								<div style={{ textAlign: 'center' }}>
									<div
										style={{
											fontSize: '24px',
											fontWeight: 'bold',
											color:
												totals.balance >= 0
													? '#007017'
													: '#d63638',
										}}
									>
										{formatAmount(totals.balance)}
									</div>
									<div style={{ color: '#666' }}>
										{__('Balance', 'fair-events')}
									</div>
								</div>
							</HStack>
						)}

						{entries.length > 0 && (
							<div style={{ overflowX: 'auto' }}>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>{__('Date', 'fair-events')}</th>
											<th>{__('Type', 'fair-events')}</th>
											<th>
												{__('Amount', 'fair-events')}
											</th>
											<th>
												{__(
													'Description',
													'fair-events'
												)}
											</th>
										</tr>
									</thead>
									<tbody>
										{entries.map((entry) => (
											<tr key={entry.id}>
												<td>{entry.entry_date}</td>
												<td>
													<span
														style={{
															color:
																entry.entry_type ===
																'cost'
																	? '#d63638'
																	: '#007017',
															fontWeight: 'bold',
														}}
													>
														{entry.entry_type ===
														'cost'
															? __(
																	'Cost',
																	'fair-events'
															  )
															: __(
																	'Income',
																	'fair-events'
															  )}
													</span>
												</td>
												<td>
													<strong>
														{formatAmount(
															entry.amount
														)}
													</strong>
												</td>
												<td>
													{entry.description || (
														<em>-</em>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}

						{transactions.length > 0 && (
							<div style={{ overflowX: 'auto' }}>
								<h3 style={{ marginBottom: '8px' }}>
									{__('Payments', 'fair-events')}
								</h3>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>{__('Date', 'fair-events')}</th>
											<th>
												{__('Amount', 'fair-events')}
											</th>
											<th>
												{__(
													'Description',
													'fair-events'
												)}
											</th>
											<th>
												{__(
													'Participant',
													'fair-events'
												)}
											</th>
										</tr>
									</thead>
									<tbody>
										{transactions.map((tx) => (
											<tr key={tx.id}>
												<td>
													{tx.created_at
														? tx.created_at.slice(
																0,
																10
														  )
														: '-'}
												</td>
												<td>
													<a
														href={`admin.php?page=fair-payment-transaction&transaction_id=${tx.id}`}
													>
														<strong
															style={{
																color: '#007017',
															}}
														>
															{formatAmount(
																tx.amount
															)}
														</strong>
													</a>
												</td>
												<td>
													{tx.description || (
														<em>-</em>
													)}
												</td>
												<td>{renderParticipant(tx)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}

						{failedTransactions.length > 0 && (
							<div style={{ overflowX: 'auto' }}>
								<h3 style={{ marginBottom: '8px' }}>
									{__('Failed Payments', 'fair-events')}
								</h3>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>{__('Date', 'fair-events')}</th>
											<th>
												{__('Amount', 'fair-events')}
											</th>
											<th>
												{__('Status', 'fair-events')}
											</th>
											<th>
												{__(
													'Description',
													'fair-events'
												)}
											</th>
											<th>
												{__(
													'Participant',
													'fair-events'
												)}
											</th>
										</tr>
									</thead>
									<tbody>
										{failedTransactions.map((tx) => (
											<tr key={tx.id}>
												<td>
													{tx.created_at
														? tx.created_at.slice(
																0,
																10
														  )
														: '-'}
												</td>
												<td>
													<a
														href={`admin.php?page=fair-payment-transaction&transaction_id=${tx.id}`}
													>
														<strong
															style={{
																color: '#d63638',
															}}
														>
															{formatAmount(
																tx.amount
															)}
														</strong>
													</a>
												</td>
												<td>
													<span
														style={{
															color: '#d63638',
															fontWeight: 'bold',
														}}
													>
														{tx.status}
													</span>
												</td>
												<td>
													{tx.description || (
														<em>-</em>
													)}
												</td>
												<td>{renderParticipant(tx)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}

						{entries.length === 0 &&
							transactions.length === 0 &&
							failedTransactions.length === 0 &&
							!totals?.total_cost &&
							!totals?.total_income && (
								<p
									style={{
										textAlign: 'center',
										color: '#666',
									}}
								>
									{__(
										'No financial entries for this event yet.',
										'fair-events'
									)}
								</p>
							)}

						<Button variant="secondary" href={viewAllUrl}>
							{__('View All Entries', 'fair-events')}
						</Button>
					</VStack>
				)}
			</CardBody>
		</Card>
	);
}
