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

/**
 * Internal dependencies
 */
import ImportTransactionsModal from './components/ImportTransactionsModal.js';

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
	const [isImportModalOpen, setIsImportModalOpen] = useState(false);
	const [feeSync, setFeeSync] = useState(null);

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
				detail_url: t.event_url || '',
				event_date_id: t.event_date_id ?? null,
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

	const handleImported = (message) => {
		setError(null);
		setSuccess(message);
		setIsImportModalOpen(false);
		loadTransactions();
	};

	const handleLoadMissingFees = async () => {
		setError(null);
		setSuccess(null);
		setFeeSync({
			running: true,
			processed: 0,
			total: 0,
			succeeded: 0,
			failed: 0,
		});

		try {
			const params = new URLSearchParams();
			if (filters.mode) params.append('mode', filters.mode);

			const response = await apiFetch({
				path: `/fair-payment/v1/transactions/missing-mollie-fee?${params.toString()}`,
			});

			const ids = response.ids || [];

			if (ids.length === 0) {
				setFeeSync(null);
				setSuccess(
					__(
						'No paid transactions are missing Mollie fee data.',
						'fair-payment'
					)
				);
				return;
			}

			setFeeSync((prev) => ({ ...prev, total: ids.length }));

			let succeeded = 0;
			let failed = 0;

			for (let i = 0; i < ids.length; i++) {
				try {
					const result = await apiFetch({
						path: `/fair-payment/v1/transactions/${ids[i]}/sync-mollie`,
						method: 'POST',
					});
					if (result && result.mollie_fee !== null) {
						succeeded += 1;
					} else {
						failed += 1;
					}
				} catch (err) {
					failed += 1;
				}
				setFeeSync({
					running: i + 1 < ids.length,
					processed: i + 1,
					total: ids.length,
					succeeded,
					failed,
				});
			}

			setFeeSync(null);
			setSuccess(
				/* translators: 1: synced count, 2: failed count, 3: total count */
				__(
					'Mollie fee sync complete: %1$d updated, %2$d failed (out of %3$d).',
					'fair-payment'
				)
					.replace('%1$d', succeeded)
					.replace('%2$d', failed)
					.replace('%3$d', ids.length)
			);
			loadTransactions();
		} catch (err) {
			setFeeSync(null);
			setError(
				err.message ||
					__('Failed to load missing Mollie fees.', 'fair-payment')
			);
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

			<Card>
				<CardHeader>
					<HStack
						justify="space-between"
						wrap
						style={{ rowGap: '8px' }}
					>
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
						<HStack
							spacing={2}
							expanded={false}
							wrap
							style={{ rowGap: '8px' }}
						>
							{selectedTransactions.size > 0 && (
								<Button
									variant="secondary"
									onClick={handleExport}
									style={{ flexShrink: 0, width: 'auto' }}
								>
									{__('Export Selected', 'fair-payment')}
								</Button>
							)}
							<Button
								variant="secondary"
								onClick={handleLoadMissingFees}
								isBusy={!!feeSync?.running}
								disabled={!!feeSync?.running}
								style={{
									whiteSpace: 'nowrap',
									flexShrink: 0,
									width: 'auto',
								}}
							>
								{feeSync?.running
									? __('Syncing…', 'fair-payment')
									: __(
											'Load Missing Mollie Fees',
											'fair-payment'
									  )}
							</Button>
							<Button
								variant="secondary"
								onClick={() => setIsImportModalOpen(true)}
								style={{ flexShrink: 0, width: 'auto' }}
							>
								{__('Import', 'fair-payment')}
							</Button>
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

					{feeSync && feeSync.running && (
						<Notice status="info" isDismissible={false}>
							{
								/* translators: 1: processed count, 2: total count, 3: succeeded count, 4: failed count */
								__(
									'Syncing Mollie fees: %1$d / %2$d (updated: %3$d, failed: %4$d)',
									'fair-payment'
								)
									.replace('%1$d', feeSync.processed)
									.replace('%2$d', feeSync.total)
									.replace('%3$d', feeSync.succeeded)
									.replace('%4$d', feeSync.failed)
							}
						</Notice>
					)}

					{loading ? (
						<Spinner />
					) : transactions.length === 0 ? (
						<p>{__('No transactions found.', 'fair-payment')}</p>
					) : (
						<>
							<table
								className="wp-list-table widefat striped"
								style={{ whiteSpace: 'nowrap' }}
							>
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
										<th
											style={{
												maxWidth: '200px',
												whiteSpace: 'normal',
											}}
										>
											{__('Description', 'fair-payment')}
										</th>
										<th>{__('Person', 'fair-payment')}</th>
										<th>{__('Entry', 'fair-payment')}</th>
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
											<td
												style={{
													maxWidth: '200px',
													whiteSpace: 'normal',
												}}
											>
												{t.description}
											</td>
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
											<td>
												{t.entry_ids &&
												t.entry_ids.length > 0
													? t.entry_ids.map(
															(entryId, i) => (
																<span
																	key={
																		entryId
																	}
																>
																	{i > 0 &&
																		', '}
																	<a
																		href={`admin.php?page=fair-payment-entries&entry_id=${entryId}`}
																	>
																		#
																		{
																			entryId
																		}
																	</a>
																</span>
															)
													  )
													: '-'}
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

			{isImportModalOpen && (
				<ImportTransactionsModal
					onClose={() => setIsImportModalOpen(false)}
					onImported={handleImported}
				/>
			)}
		</div>
	);
};

export default TransactionsApp;
