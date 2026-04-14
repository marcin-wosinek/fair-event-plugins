/**
 * WordPress dependencies
 */
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
	__experimentalVStack as VStack,
} from '@wordpress/components';

const organizationId = window.fairPaymentTransactions?.organizationId || '';

const getStatusStyle = (status) => {
	switch (status) {
		case 'paid':
			return {
				color: '#007017',
				fontWeight: 'bold',
				background: '#edfaef',
				padding: '2px 8px',
				borderRadius: '3px',
			};
		case 'failed':
		case 'canceled':
		case 'expired':
			return {
				color: '#d63638',
				fontWeight: 'bold',
				background: '#fce8e8',
				padding: '2px 8px',
				borderRadius: '3px',
			};
		case 'open':
		case 'pending':
		case 'pending_payment':
			return {
				color: '#996800',
				fontWeight: 'bold',
				background: '#fef8ee',
				padding: '2px 8px',
				borderRadius: '3px',
			};
		default:
			return {
				padding: '2px 8px',
				borderRadius: '3px',
			};
	}
};

const getMollieUrl = (molliePaymentId) => {
	if (!molliePaymentId) return null;
	if (organizationId) {
		return `https://my.mollie.com/dashboard/${organizationId}/payments/${molliePaymentId}`;
	}
	return `https://www.mollie.com/dashboard/payments/${molliePaymentId}`;
};

const DetailRow = ({ label, children }) => (
	<tr>
		<th
			style={{
				textAlign: 'left',
				padding: '6px 12px 6px 0',
				verticalAlign: 'top',
				whiteSpace: 'nowrap',
				fontWeight: 'normal',
				color: '#646970',
				width: '160px',
			}}
		>
			{label}
		</th>
		<td style={{ padding: '6px 0' }}>{children}</td>
	</tr>
);

const TransactionPage = () => {
	const [transaction, setTransaction] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [syncing, setSyncing] = useState(false);
	const [syncNotice, setSyncNotice] = useState(null);

	const params = new URLSearchParams(window.location.search);
	const transactionId = params.get('transaction_id');

	const handleSyncMollie = () => {
		setSyncing(true);
		setSyncNotice(null);

		apiFetch({
			path: `/fair-payment/v1/transactions/${transactionId}/sync-mollie`,
			method: 'POST',
		})
			.then((data) => {
				setTransaction(data);
				setSyncNotice({
					status: data.mollie_fee !== null ? 'success' : 'warning',
					message:
						data.mollie_fee !== null
							? __(
									'Synced with Mollie successfully.',
									'fair-payment'
							  )
							: __(
									'Mollie responded but the settlement fee could not be extracted. See Mollie response below.',
									'fair-payment'
							  ),
					debug: data.sync_debug || null,
				});
			})
			.catch((err) => {
				setSyncNotice({
					status: 'error',
					message:
						err.message ||
						__('Failed to sync with Mollie.', 'fair-payment'),
				});
			})
			.finally(() => {
				setSyncing(false);
			});
	};

	useEffect(() => {
		if (!transactionId) {
			setError(__('No transaction ID provided.', 'fair-payment'));
			setLoading(false);
			return;
		}

		apiFetch({
			path: `/fair-payment/v1/transactions/${transactionId}`,
		})
			.then((data) => {
				setTransaction(data);
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to load transaction.', 'fair-payment')
				);
			})
			.finally(() => {
				setLoading(false);
			});
	}, [transactionId]);

	if (loading) {
		return (
			<div className="wrap">
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Transaction Detail', 'fair-payment')}</h1>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
				<p>
					<a href="admin.php?page=fair-payment-transactions">
						&larr; {__('Back to Transactions', 'fair-payment')}
					</a>
				</p>
			</div>
		);
	}

	const t = transaction;
	const mollieUrl = getMollieUrl(t.mollie_payment_id);

	return (
		<div className="wrap">
			<HStack style={{ marginBottom: '16px', alignItems: 'center' }}>
				<div>
					<a href="admin.php?page=fair-payment-transactions">
						&larr; {__('Back to Transactions', 'fair-payment')}
					</a>
					<h1 style={{ margin: '8px 0 0' }}>
						{__('Transaction', 'fair-payment')} #{t.id}{' '}
						<span style={getStatusStyle(t.status)}>
							{t.status.charAt(0).toUpperCase() +
								t.status.slice(1)}
						</span>
					</h1>
				</div>
			</HStack>

			<VStack spacing={4}>
				<Card>
					<CardHeader>
						<HStack justify="space-between" alignment="center">
							<Heading level={4}>
								{__('Payment Details', 'fair-payment')}
							</Heading>
							{t.mollie_payment_id && (
								<Button
									variant="secondary"
									onClick={handleSyncMollie}
									isBusy={syncing}
									disabled={syncing}
								>
									{syncing
										? __('Syncing…', 'fair-payment')
										: __(
												'Sync with Mollie',
												'fair-payment'
										  )}
								</Button>
							)}
						</HStack>
					</CardHeader>
					{syncNotice && (
						<CardBody style={{ paddingBottom: 0 }}>
							<Notice
								status={syncNotice.status}
								isDismissible
								onRemove={() => setSyncNotice(null)}
							>
								{syncNotice.message}
								{syncNotice.debug && (
									<pre
										style={{
											marginTop: '8px',
											padding: '8px',
											background: '#f6f7f7',
											fontSize: '11px',
											overflowX: 'auto',
										}}
									>
										{JSON.stringify(
											syncNotice.debug,
											null,
											2
										)}
									</pre>
								)}
							</Notice>
						</CardBody>
					)}
					<CardBody>
						<table>
							<tbody>
								<DetailRow label={__('Amount', 'fair-payment')}>
									<strong>{t.amount.toFixed(2)}</strong>{' '}
									{t.currency}
								</DetailRow>
								<DetailRow
									label={__('Mollie Fee', 'fair-payment')}
								>
									{t.mollie_fee !== null
										? `${t.mollie_fee.toFixed(2)} ${
												t.currency
										  }`
										: '-'}
								</DetailRow>
								<DetailRow
									label={__(
										'Integration Fee',
										'fair-payment'
									)}
								>
									{t.application_fee !== null
										? `${t.application_fee.toFixed(2)} ${
												t.currency
										  }`
										: '-'}
								</DetailRow>
								<DetailRow label={__('Mode', 'fair-payment')}>
									<span
										style={
											t.testmode
												? {
														color: '#996800',
														fontWeight: 'bold',
												  }
												: {
														color: '#007017',
														fontWeight: 'bold',
												  }
										}
									>
										{t.testmode
											? __('Test', 'fair-payment')
											: __('Live', 'fair-payment')}
									</span>
								</DetailRow>
							</tbody>
						</table>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<Heading level={4}>
							{__('Status & Timing', 'fair-payment')}
						</Heading>
					</CardHeader>
					<CardBody>
						<table>
							<tbody>
								<DetailRow label={__('Status', 'fair-payment')}>
									<span style={getStatusStyle(t.status)}>
										{t.status.charAt(0).toUpperCase() +
											t.status.slice(1)}
									</span>
								</DetailRow>
								<DetailRow
									label={__('Created', 'fair-payment')}
								>
									{t.created_at || '-'}
								</DetailRow>
								<DetailRow
									label={__(
										'Payment Initiated',
										'fair-payment'
									)}
								>
									{t.payment_initiated_at || '-'}
								</DetailRow>
								<DetailRow
									label={__('Updated', 'fair-payment')}
								>
									{t.updated_at || '-'}
								</DetailRow>
							</tbody>
						</table>
					</CardBody>
				</Card>

				{t.description && (
					<Card>
						<CardHeader>
							<Heading level={4}>
								{__('Description', 'fair-payment')}
							</Heading>
						</CardHeader>
						<CardBody>{t.description}</CardBody>
					</Card>
				)}

				{t.metadata &&
					typeof t.metadata === 'object' &&
					Object.keys(t.metadata).length > 0 && (
						<Card>
							<CardHeader>
								<Heading level={4}>
									{__('Metadata', 'fair-payment')}
								</Heading>
							</CardHeader>
							<CardBody>
								<table>
									<tbody>
										{Object.entries(t.metadata).map(
											([key, value]) => (
												<DetailRow
													key={key}
													label={key}
												>
													{typeof value === 'object'
														? JSON.stringify(value)
														: String(value)}
												</DetailRow>
											)
										)}
									</tbody>
								</table>
							</CardBody>
						</Card>
					)}

				{t.line_items && t.line_items.length > 0 && (
					<Card>
						<CardHeader>
							<Heading level={4}>
								{__('Line Items', 'fair-payment')}
							</Heading>
						</CardHeader>
						<CardBody>
							<table className="wp-list-table widefat fixed striped">
								<thead>
									<tr>
										<th>{__('Name', 'fair-payment')}</th>
										<th>
											{__('Description', 'fair-payment')}
										</th>
										<th>
											{__('Quantity', 'fair-payment')}
										</th>
										<th>
											{__('Unit Amount', 'fair-payment')}
										</th>
										<th>{__('Total', 'fair-payment')}</th>
									</tr>
								</thead>
								<tbody>
									{t.line_items.map((item) => (
										<tr key={item.id}>
											<td>{item.name}</td>
											<td>{item.description || '-'}</td>
											<td>{item.quantity}</td>
											<td>
												{item.unit_amount.toFixed(2)}{' '}
												{t.currency}
											</td>
											<td>
												{item.total_amount.toFixed(2)}{' '}
												{t.currency}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</CardBody>
					</Card>
				)}

				<Card>
					<CardHeader>
						<Heading level={4}>
							{__('User & Post', 'fair-payment')}
						</Heading>
					</CardHeader>
					<CardBody>
						<table>
							<tbody>
								<DetailRow label={__('User', 'fair-payment')}>
									{t.user_id ? (
										<a
											href={`user-edit.php?user_id=${t.user_id}`}
										>
											{t.user_name || `#${t.user_id}`}
										</a>
									) : (
										'-'
									)}
								</DetailRow>
								<DetailRow label={__('Post', 'fair-payment')}>
									{t.post_id ? (
										<a
											href={`post.php?post=${t.post_id}&action=edit`}
										>
											{t.post_title || `#${t.post_id}`}
										</a>
									) : (
										'-'
									)}
								</DetailRow>
							</tbody>
						</table>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<Heading level={4}>
							{__('URLs & Mollie', 'fair-payment')}
						</Heading>
					</CardHeader>
					<CardBody>
						<table>
							<tbody>
								<DetailRow
									label={__(
										'Mollie Payment ID',
										'fair-payment'
									)}
								>
									{t.mollie_payment_id ? (
										mollieUrl ? (
											<a
												href={mollieUrl}
												target="_blank"
												rel="noopener noreferrer"
											>
												<code>
													{t.mollie_payment_id}
												</code>
											</a>
										) : (
											<code>{t.mollie_payment_id}</code>
										)
									) : (
										'-'
									)}
								</DetailRow>
								<DetailRow
									label={__('Redirect URL', 'fair-payment')}
								>
									{t.redirect_url ? (
										<code
											style={{
												wordBreak: 'break-all',
											}}
										>
											{t.redirect_url}
										</code>
									) : (
										'-'
									)}
								</DetailRow>
								<DetailRow
									label={__('Webhook URL', 'fair-payment')}
								>
									{t.webhook_url ? (
										<code
											style={{
												wordBreak: 'break-all',
											}}
										>
											{t.webhook_url}
										</code>
									) : (
										'-'
									)}
								</DetailRow>
								<DetailRow
									label={__('Checkout URL', 'fair-payment')}
								>
									{t.checkout_url ? (
										<a
											href={t.checkout_url}
											target="_blank"
											rel="noopener noreferrer"
											style={{
												wordBreak: 'break-all',
											}}
										>
											{t.checkout_url}
										</a>
									) : (
										'-'
									)}
								</DetailRow>
							</tbody>
						</table>
					</CardBody>
				</Card>
			</VStack>
		</div>
	);
};

export default TransactionPage;
