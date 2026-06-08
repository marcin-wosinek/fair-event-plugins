import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	__experimentalHeading as Heading,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const levelStyle = (level) => {
	switch (level) {
		case 'error':
			return {
				color: '#d63638',
				background: '#fce8e8',
				fontWeight: 'bold',
				padding: '1px 6px',
				borderRadius: '3px',
				fontSize: '11px',
				textTransform: 'uppercase',
			};
		case 'warning':
			return {
				color: '#996800',
				background: '#fef8ee',
				fontWeight: 'bold',
				padding: '1px 6px',
				borderRadius: '3px',
				fontSize: '11px',
				textTransform: 'uppercase',
			};
		default:
			return {
				color: '#1d4f6e',
				background: '#eef6fc',
				padding: '1px 6px',
				borderRadius: '3px',
				fontSize: '11px',
				textTransform: 'uppercase',
			};
	}
};

const TransactionLog = ({ transactionId }) => {
	const [entries, setEntries] = useState(null);
	const [error, setError] = useState(null);
	const [reloading, setReloading] = useState(false);

	const load = () => {
		setReloading(true);
		setError(null);
		return apiFetch({
			path: `/fair-payments-connector/v1/transactions/${transactionId}/log`,
		})
			.then((data) => {
				setEntries(Array.isArray(data) ? data : []);
			})
			.catch((err) => {
				setError(
					err.message ||
						__(
							'Failed to load log entries.',
							'fair-payments-connector'
						)
				);
			})
			.finally(() => {
				setReloading(false);
			});
	};

	useEffect(() => {
		if (!transactionId) {
			return;
		}
		load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [transactionId]);

	return (
		<Card>
			<CardHeader>
				<HStack justify="space-between" alignment="center">
					<Heading level={4}>
						{__('Event Log', 'fair-payments-connector')}
					</Heading>
					<Button
						variant="secondary"
						size="small"
						onClick={load}
						isBusy={reloading}
						disabled={reloading}
					>
						{__('Refresh', 'fair-payments-connector')}
					</Button>
				</HStack>
			</CardHeader>
			<CardBody>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}
				{!error && entries === null && <Spinner />}
				{!error && Array.isArray(entries) && entries.length === 0 && (
					<p style={{ margin: 0, color: '#646970' }}>
						{__(
							'No log entries for this transaction yet.',
							'fair-payments-connector'
						)}
					</p>
				)}
				{!error && Array.isArray(entries) && entries.length > 0 && (
					<table className="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<th style={{ width: '160px' }}>
									{__('Time', 'fair-payments-connector')}
								</th>
								<th style={{ width: '70px' }}>
									{__('Level', 'fair-payments-connector')}
								</th>
								<th style={{ width: '180px' }}>
									{__('Event', 'fair-payments-connector')}
								</th>
								<th>
									{__('Message', 'fair-payments-connector')}
								</th>
								<th style={{ width: '110px' }}>
									{__('Request', 'fair-payments-connector')}
								</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((entry) => (
								<tr key={entry.id}>
									<td
										style={{
											fontFamily: 'monospace',
											fontSize: '11px',
											verticalAlign: 'top',
										}}
									>
										{entry.created_at}
									</td>
									<td style={{ verticalAlign: 'top' }}>
										<span style={levelStyle(entry.level)}>
											{entry.level}
										</span>
									</td>
									<td
										style={{
											fontFamily: 'monospace',
											fontSize: '12px',
											verticalAlign: 'top',
										}}
									>
										{entry.event}
									</td>
									<td style={{ verticalAlign: 'top' }}>
										<div>{entry.message || '-'}</div>
										{entry.context && (
											<details
												style={{
													marginTop: '4px',
												}}
											>
												<summary
													style={{
														cursor: 'pointer',
														fontSize: '11px',
														color: '#646970',
													}}
												>
													{__(
														'Context',
														'fair-payments-connector'
													)}
												</summary>
												<pre
													style={{
														marginTop: '4px',
														padding: '6px',
														background: '#f6f7f7',
														fontSize: '11px',
														overflowX: 'auto',
														whiteSpace: 'pre-wrap',
														wordBreak: 'break-word',
													}}
												>
													{typeof entry.context ===
													'string'
														? entry.context
														: JSON.stringify(
																entry.context,
																null,
																2
														  )}
												</pre>
											</details>
										)}
									</td>
									<td
										style={{
											fontFamily: 'monospace',
											fontSize: '10px',
											color: '#646970',
											verticalAlign: 'top',
											wordBreak: 'break-all',
										}}
										title={entry.request_id || ''}
									>
										{entry.request_id
											? entry.request_id.substring(0, 8)
											: '-'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</CardBody>
		</Card>
	);
};

export default TransactionLog;
