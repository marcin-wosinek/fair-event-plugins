/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	SelectControl,
	Button,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const organizationId = window.fairPaymentTransactions?.organizationId || '';
const settingsUrl = 'admin.php?page=fair-payment-settings';

const STATUS_OPTIONS = [
	{ label: __('All statuses', 'fair-payment'), value: '' },
	{ label: __('Paid', 'fair-payment'), value: 'paid' },
	{ label: __('Pending', 'fair-payment'), value: 'pending' },
	{ label: __('Open', 'fair-payment'), value: 'open' },
	{ label: __('Failed', 'fair-payment'), value: 'failed' },
	{ label: __('Canceled', 'fair-payment'), value: 'canceled' },
	{ label: __('Expired', 'fair-payment'), value: 'expired' },
	{ label: __('Draft', 'fair-payment'), value: 'draft' },
	{
		label: __('Pending payment', 'fair-payment'),
		value: 'pending_payment',
	},
];

const MODE_OPTIONS = [
	{ label: __('Live', 'fair-payment'), value: 'live' },
	{ label: __('Test', 'fair-payment'), value: 'test' },
	{ label: __('All modes', 'fair-payment'), value: '' },
];

const getStatusStyle = (status) => {
	switch (status) {
		case 'paid':
			return { color: '#007017', fontWeight: 'bold' };
		case 'failed':
		case 'canceled':
		case 'expired':
			return { color: '#d63638', fontWeight: 'bold' };
		case 'open':
		case 'pending':
		case 'pending_payment':
			return { color: '#996800', fontWeight: 'bold' };
		default:
			return {};
	}
};

const getModeStyle = (testmode) => {
	return testmode
		? { color: '#996800', fontWeight: 'bold' }
		: { color: '#007017', fontWeight: 'bold' };
};

const getMollieUrl = (molliePaymentId) => {
	if (!molliePaymentId) return null;
	if (organizationId) {
		return `https://my.mollie.com/dashboard/${organizationId}/payments/${molliePaymentId}`;
	}
	return `https://www.mollie.com/dashboard/payments/${molliePaymentId}`;
};

const TransactionsApp = () => {
	const [transactions, setTransactions] = useState([]);
	const [pagination, setPagination] = useState({
		total: 0,
		pages: 0,
		page: 1,
	});
	const [filters, setFilters] = useState({
		status: 'paid',
		mode: 'live',
	});
	const [sort, setSort] = useState({
		orderby: 'created_at',
		order: 'desc',
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [selectedTransactions, setSelectedTransactions] = useState(new Set());
	const [isImporting, setIsImporting] = useState(false);

	const loadTransactions = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			params.append('page', pagination.page);
			params.append('per_page', 50);
			if (filters.status) params.append('status', filters.status);
			if (filters.mode) params.append('mode', filters.mode);
			params.append('orderby', sort.orderby);
			params.append('order', sort.order);

			const data = await apiFetch({
				path: `/fair-payment/v1/transactions?${params.toString()}`,
			});

			setTransactions(data.transactions);
			setPagination((prev) => ({
				...prev,
				total: data.total,
				pages: data.pages,
			}));
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load transactions.', 'fair-payment')
			);
		} finally {
			setLoading(false);
		}
	}, [filters, pagination.page, sort]);

	useEffect(() => {
		loadTransactions();
	}, [loadTransactions]);

	const handleSort = (column) => {
		setSort((prev) => ({
			orderby: column,
			order:
				prev.orderby === column && prev.order === 'desc'
					? 'asc'
					: 'desc',
		}));
	};

	const getSortIndicator = (column) => {
		if (sort.orderby !== column) return '';
		return sort.order === 'asc' ? ' \u25B2' : ' \u25BC';
	};

	const toggleTransactionSelection = (id) => {
		setSelectedTransactions((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleAllTransactions = () => {
		if (selectedTransactions.size === transactions.length) {
			setSelectedTransactions(new Set());
		} else {
			setSelectedTransactions(new Set(transactions.map((t) => t.id)));
		}
	};

	const handleExport = () => {
		const sourceDomain = window.location.hostname;
		const siteUrl = window.location.origin;

		const toExport = transactions
			.filter((t) => selectedTransactions.has(t.id))
			.map((t) => ({
				amount: t.amount,
				currency: t.currency,
				mollie_fee: t.mollie_fee,
				application_fee: t.application_fee,
				status: t.status,
				testmode: t.testmode,
				description: t.description,
				created_at: t.created_at,
				mollie_payment_id: t.mollie_payment_id,
				source_domain: sourceDomain,
				detail_url: `${siteUrl}/wp-admin/admin.php?page=fair-payment-transaction&transaction_id=${t.id}`,
			}));

		const blob = new Blob([JSON.stringify(toExport, null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'transactions.json';
		a.click();
		URL.revokeObjectURL(url);
		setSuccess(
			// translators: %d is the number of exported transactions
			__('%d transaction(s) exported.', 'fair-payment').replace(
				'%d',
				toExport.length
			)
		);
	};

	const handleImport = async (e) => {
		const file = e.target.files[0];
		if (!file) {
			return;
		}

		// Reset the input so the same file can be re-selected
		e.target.value = '';

		setIsImporting(true);
		setError(null);
		setSuccess(null);

		try {
			const text = await file.text();
			const imported = JSON.parse(text);

			if (!Array.isArray(imported)) {
				throw new Error(
					__(
						'Invalid file format. Expected a JSON array.',
						'fair-payment'
					)
				);
			}

			const toImport = imported.filter((t) => t.mollie_payment_id);

			if (toImport.length === 0) {
				throw new Error(
					__(
						'No valid transactions found in the file.',
						'fair-payment'
					)
				);
			}

			const response = await apiFetch({
				path: '/fair-payment/v1/transactions/import',
				method: 'POST',
				data: {
					transactions: toImport,
				},
			});

			setSuccess(response.message);
			loadTransactions();
		} catch (err) {
			setError(
				err.message ||
					__('Failed to import transactions.', 'fair-payment')
			);
		} finally {
			setIsImporting(false);
		}
	};

	const sortableHeader = (column, label) => (
		<th style={{ cursor: 'pointer' }} onClick={() => handleSort(column)}>
			{label}
			{getSortIndicator(column)}
		</th>
	);

	return (
		<div className="wrap">
			<h1>{__('Payment Transactions', 'fair-payment')}</h1>

			{!organizationId && (
				<Notice status="warning" isDismissible={false}>
					<p>
						{__(
							'To enable direct links to Mollie transactions, please configure your Organization ID in the',
							'fair-payment'
						)}{' '}
						<a href={settingsUrl}>
							{__('settings', 'fair-payment')}
						</a>
						.
					</p>
				</Notice>
			)}

			<Card>
				<CardHeader>
					<HStack justify="space-between">
						<HStack>
							<SelectControl
								label={__('Status', 'fair-payment')}
								value={filters.status}
								options={STATUS_OPTIONS}
								onChange={(value) => {
									setFilters((prev) => ({
										...prev,
										status: value,
									}));
									setPagination((prev) => ({
										...prev,
										page: 1,
									}));
								}}
								__nextHasNoMarginBottom
							/>
							<SelectControl
								label={__('Mode', 'fair-payment')}
								value={filters.mode}
								options={MODE_OPTIONS}
								onChange={(value) => {
									setFilters((prev) => ({
										...prev,
										mode: value,
									}));
									setPagination((prev) => ({
										...prev,
										page: 1,
									}));
								}}
								__nextHasNoMarginBottom
							/>
						</HStack>
						<HStack spacing={2} expanded={false}>
							{selectedTransactions.size > 0 && (
								<Button
									variant="secondary"
									onClick={handleExport}
								>
									{__('Export Selected', 'fair-payment')}
								</Button>
							)}
							<Button
								variant="secondary"
								onClick={() =>
									document
										.getElementById(
											'fair-payment-transaction-import'
										)
										.click()
								}
								isBusy={isImporting}
								disabled={isImporting}
							>
								{__('Import', 'fair-payment')}
							</Button>
							<input
								id="fair-payment-transaction-import"
								type="file"
								accept=".json"
								style={{ display: 'none' }}
								onChange={handleImport}
							/>
						</HStack>
					</HStack>
				</CardHeader>
				<CardBody style={{ overflowX: 'auto' }}>
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

					{loading ? (
						<Spinner />
					) : transactions.length === 0 ? (
						<p>{__('No transactions found.', 'fair-payment')}</p>
					) : (
						<>
							<table className="wp-list-table widefat striped" style={{ whiteSpace: 'nowrap' }}>
								<thead>
									<tr>
										<td className="check-column">
											<input
												type="checkbox"
												checked={
													selectedTransactions.size ===
													transactions.length
												}
												onChange={toggleAllTransactions}
											/>
										</td>
										{sortableHeader(
											'id',
											__('ID', 'fair-payment')
										)}
										<th>
											{__('Mollie ID', 'fair-payment')}
										</th>
										{sortableHeader(
											'amount',
											__('Amount', 'fair-payment')
										)}
										<th>
											{__('Mollie Fee', 'fair-payment')}
										</th>
										<th>
											{__(
												'Integration Fee',
												'fair-payment'
											)}
										</th>
										{sortableHeader(
											'status',
											__('Status', 'fair-payment')
										)}
										<th>{__('Mode', 'fair-payment')}</th>
										<th>
											{__('Description', 'fair-payment')}
										</th>
										<th>{__('Person', 'fair-payment')}</th>
										{sortableHeader(
											'created_at',
											__('Date', 'fair-payment')
										)}
									</tr>
								</thead>
								<tbody>
									{transactions.map((t) => (
										<tr key={t.id}>
											<th className="check-column">
												<input
													type="checkbox"
													checked={selectedTransactions.has(
														t.id
													)}
													onChange={() =>
														toggleTransactionSelection(
															t.id
														)
													}
												/>
											</th>
											<td>
												<a
													href={`admin.php?page=fair-payment-transaction&transaction_id=${t.id}`}
												>
													{t.id}
												</a>
											</td>
											<td>
												{t.mollie_payment_id ? (
													<a
														href={getMollieUrl(
															t.mollie_payment_id
														)}
														target="_blank"
														rel="noopener noreferrer"
														title={__(
															'View in Mollie Dashboard',
															'fair-payment'
														)}
													>
														<code>
															{
																t.mollie_payment_id
															}
														</code>
													</a>
												) : (
													<code>-</code>
												)}
											</td>
											<td>
												<strong>
													{t.amount.toFixed(2)}
												</strong>{' '}
												{t.currency}
											</td>
											<td>
												{t.mollie_fee !== null
													? `${t.mollie_fee.toFixed(
															2
													  )} ${t.currency}`
													: '-'}
											</td>
											<td>
												{t.application_fee !== null
													? `${t.application_fee.toFixed(
															2
													  )} ${t.currency}`
													: '-'}
											</td>
											<td>
												<span
													style={getStatusStyle(
														t.status
													)}
												>
													{t.status
														.charAt(0)
														.toUpperCase() +
														t.status.slice(1)}
												</span>
											</td>
											<td>
												<span
													style={getModeStyle(
														t.testmode
													)}
												>
													{t.testmode
														? __(
																'Test',
																'fair-payment'
														  )
														: __(
																'Live',
																'fair-payment'
														  )}
												</span>
											</td>
											<td>{t.description}</td>
											<td>
												{t.participant ? (
													<a
														href={
															t.participant
																.admin_url
														}
													>
														{t.participant.name ||
															t.participant
																.email ||
															`#${t.participant.id}`}
													</a>
												) : (
													t.user_name || '-'
												)}
											</td>
											<td>{t.created_at}</td>
										</tr>
									))}
								</tbody>
							</table>

							{pagination.pages > 1 && (
								<HStack
									style={{
										marginTop: '16px',
										justifyContent: 'center',
									}}
								>
									<Button
										variant="secondary"
										disabled={pagination.page <= 1}
										onClick={() =>
											setPagination((prev) => ({
												...prev,
												page: prev.page - 1,
											}))
										}
									>
										{__('Previous', 'fair-payment')}
									</Button>
									<span>
										{pagination.page} / {pagination.pages}
									</span>
									<Button
										variant="secondary"
										disabled={
											pagination.page >= pagination.pages
										}
										onClick={() =>
											setPagination((prev) => ({
												...prev,
												page: prev.page + 1,
											}))
										}
									>
										{__('Next', 'fair-payment')}
									</Button>
								</HStack>
							)}
						</>
					)}
				</CardBody>
			</Card>
		</div>
	);
};

export default TransactionsApp;
