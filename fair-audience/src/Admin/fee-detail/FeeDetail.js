import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Modal,
	TextControl,
	TextareaControl,
	Notice,
	Spinner,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'participant_surname',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: [
		'participant_name',
		'participant_email',
		'amount',
		'status',
		'paid_at',
		'reminder_sent_at',
	],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function FeeDetail() {
	const urlParams = new URLSearchParams(window.location.search);
	const feeId = urlParams.get('fee_id');

	const [fee, setFee] = useState(null);
	const [payments, setPayments] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	// Adjust amount modal.
	const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
	const [adjustingPayment, setAdjustingPayment] = useState(null);
	const [newAmount, setNewAmount] = useState('');
	const [adjustReason, setAdjustReason] = useState('');
	const [isSaving, setIsSaving] = useState(false);

	// Audit log modal.
	const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
	const [auditEntries, setAuditEntries] = useState([]);
	const [auditLoading, setAuditLoading] = useState(false);

	// Transactions modal.
	const [isTransactionsModalOpen, setIsTransactionsModalOpen] =
		useState(false);
	const [transactionEntries, setTransactionEntries] = useState([]);
	const [transactionsLoading, setTransactionsLoading] = useState(false);

	// Notice state.
	const [notice, setNotice] = useState(null);

	// Reminders state.
	const [isSendingReminders, setIsSendingReminders] = useState(false);

	const loadFee = useCallback(() => {
		if (!feeId) return;

		apiFetch({ path: `/fair-audience/v1/fees/${feeId}` })
			.then((data) => {
				setFee(data);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading fee:', err);
			});
	}, [feeId]);

	const loadPayments = useCallback(() => {
		if (!feeId) return;

		setIsLoading(true);

		apiFetch({ path: `/fair-audience/v1/fees/${feeId}/payments` })
			.then((data) => {
				setPayments(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading payments:', err);
				setIsLoading(false);
			});
	}, [feeId]);

	useEffect(() => {
		loadFee();
		loadPayments();
	}, [loadFee, loadPayments]);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'participant_name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) =>
					`${item.participant_name || ''} ${
						item.participant_surname || ''
					}`.trim() || '—',
				enableSorting: false,
				enableHiding: false,
			},
			{
				id: 'participant_email',
				label: __('Email', 'fair-audience'),
				render: ({ item }) => item.participant_email || '—',
				enableSorting: false,
			},
			{
				id: 'amount',
				label: __('Amount', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{parseFloat(item.amount).toFixed(2)}
					</div>
				),
				enableSorting: false,
				getValue: ({ item }) => parseFloat(item.amount),
			},
			{
				id: 'status',
				label: __('Status', 'fair-audience'),
				render: ({ item }) => {
					const colors = {
						pending: '#dba617',
						paid: '#00a32a',
						canceled: '#d63638',
					};
					return (
						<span
							style={{
								color: colors[item.status] || '#333',
								fontWeight: 'bold',
							}}
						>
							{item.status}
						</span>
					);
				},
				enableSorting: false,
			},
			{
				id: 'paid_at',
				label: __('Paid At', 'fair-audience'),
				render: ({ item }) => item.paid_at || '—',
				enableSorting: false,
			},
			{
				id: 'reminder_sent_at',
				label: __('Reminder Sent', 'fair-audience'),
				render: ({ item }) => item.reminder_sent_at || '—',
				enableSorting: false,
			},
		],
		[]
	);

	// Adjust amount.
	const openAdjustModal = (payment) => {
		setAdjustingPayment(payment);
		setNewAmount(payment.amount);
		setAdjustReason('');
		setIsAdjustModalOpen(true);
	};

	const handleAdjustAmount = () => {
		if (!adjustingPayment || !adjustReason.trim()) return;

		setIsSaving(true);

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${adjustingPayment.id}/amount`,
			method: 'PUT',
			data: {
				amount: parseFloat(newAmount),
				comment: adjustReason.trim(),
			},
		})
			.then(() => {
				setIsAdjustModalOpen(false);
				setAdjustingPayment(null);
				loadPayments();
				setNotice({
					status: 'success',
					message: __(
						'Amount adjusted successfully.',
						'fair-audience'
					),
				});
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to adjust amount.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsSaving(false);
			});
	};

	// Mark as paid.
	const handleMarkPaid = (payment) => {
		// eslint-disable-next-line no-undef
		if (!confirm(__('Mark this payment as paid?', 'fair-audience'))) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${payment.id}/mark-paid`,
			method: 'POST',
		})
			.then(() => {
				loadPayments();
				setNotice({
					status: 'success',
					message: __('Payment marked as paid.', 'fair-audience'),
				});
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to mark as paid.', 'fair-audience'))
				);
			});
	};

	// Cancel payment.
	const handleCancel = (payment) => {
		// eslint-disable-next-line no-undef
		if (!confirm(__('Cancel this payment?', 'fair-audience'))) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${payment.id}/cancel`,
			method: 'POST',
		})
			.then(() => {
				loadPayments();
				setNotice({
					status: 'success',
					message: __('Payment canceled.', 'fair-audience'),
				});
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to cancel payment.', 'fair-audience'))
				);
			});
	};

	// View audit log.
	const openAuditLog = (payment) => {
		setAuditLoading(true);
		setAuditEntries([]);
		setIsAuditModalOpen(true);

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${payment.id}/audit-log`,
		})
			.then((data) => {
				setAuditEntries(data);
				setAuditLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading audit log:', err);
				setAuditLoading(false);
			});
	};

	// View payment attempts.
	const openTransactionsModal = (payment) => {
		setTransactionsLoading(true);
		setTransactionEntries([]);
		setIsTransactionsModalOpen(true);

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${payment.id}/transactions`,
		})
			.then((data) => {
				setTransactionEntries(data);
				setTransactionsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading transactions:', err);
				setTransactionsLoading(false);
			});
	};

	// Copy payment link.
	const handleCopyPaymentLink = (payment) => {
		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/payments/${payment.id}/payment-url`,
		})
			.then((data) => {
				navigator.clipboard.writeText(data.url).then(() => {
					setNotice({
						status: 'success',
						message: __(
							'Payment link copied to clipboard.',
							'fair-audience'
						),
					});
				});
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to get payment link.', 'fair-audience'))
				);
			});
	};

	// Send reminders.
	const handleSendReminders = () => {
		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__(
					'Send payment reminders to all members with pending payments?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		setIsSendingReminders(true);

		apiFetch({
			path: `/fair-audience/v1/fees/${feeId}/send-reminders`,
			method: 'POST',
		})
			.then((results) => {
				const sentCount = results.sent ? results.sent.length : 0;
				const failedCount = results.failed ? results.failed.length : 0;

				setNotice({
					status: failedCount > 0 ? 'warning' : 'success',
					message: `${sentCount} ${__(
						'reminders sent',
						'fair-audience'
					)}${
						failedCount > 0
							? `, ${failedCount} ${__(
									'failed',
									'fair-audience'
							  )}`
							: ''
					}`,
				});

				loadPayments();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to send reminders.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsSendingReminders(false);
			});
	};

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'adjust-amount',
				label: __('Adjust Amount', 'fair-audience'),
				icon: 'edit',
				callback: ([item]) => openAdjustModal(item),
				supportsBulk: false,
			},
			{
				id: 'mark-paid',
				label: __('Mark as Paid', 'fair-audience'),
				icon: 'yes-alt',
				callback: ([item]) => handleMarkPaid(item),
				supportsBulk: false,
				isEligible: (item) => item.status === 'pending',
			},
			{
				id: 'cancel',
				label: __('Cancel', 'fair-audience'),
				icon: 'dismiss',
				callback: ([item]) => handleCancel(item),
				supportsBulk: false,
				isDestructive: true,
				isEligible: (item) => item.status === 'pending',
			},
			{
				id: 'copy-payment-link',
				label: __('Copy Payment Link', 'fair-audience'),
				icon: 'admin-links',
				callback: ([item]) => handleCopyPaymentLink(item),
				supportsBulk: false,
				isEligible: (item) => item.status === 'pending',
			},
			{
				id: 'view-transactions',
				label: __('View Payment Attempts', 'fair-audience'),
				icon: 'money-alt',
				callback: ([item]) => openTransactionsModal(item),
				supportsBulk: false,
				isEligible: (item) => !!item.transaction_id,
			},
			{
				id: 'audit-log',
				label: __('View Audit Log', 'fair-audience'),
				icon: 'list-view',
				callback: ([item]) => openAuditLog(item),
				supportsBulk: false,
			},
		],
		[feeId]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems: payments.length,
			totalPages: 1,
		}),
		[payments]
	);

	if (!feeId) {
		return (
			<div className="wrap">
				<p>{__('No fee ID specified.', 'fair-audience')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>
				<a href="admin.php?page=fair-audience-fees">
					{__('Membership Fees', 'fair-audience')}
				</a>
				{' → '}
				{fee ? fee.name : '...'}
			</h1>

			{notice && (
				<Notice
					status={notice.status}
					onRemove={() => setNotice(null)}
					isDismissible
				>
					{notice.message}
				</Notice>
			)}

			{/* Fee Summary */}
			{fee && (
				<Card style={{ marginBottom: '16px' }}>
					<CardHeader>
						<h2 style={{ margin: 0 }}>
							{__('Fee Summary', 'fair-audience')}
						</h2>
					</CardHeader>
					<CardBody>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns:
									'repeat(auto-fit, minmax(200px, 1fr))',
								gap: '16px',
							}}
						>
							<div>
								<strong>{__('Name:', 'fair-audience')}</strong>{' '}
								{fee.name}
							</div>
							<div>
								<strong>{__('Group:', 'fair-audience')}</strong>{' '}
								{fee.group_name || '—'}
							</div>
							<div>
								<strong>
									{__('Default Amount:', 'fair-audience')}
								</strong>{' '}
								{parseFloat(fee.amount).toFixed(2)}{' '}
								{fee.currency}
							</div>
							<div>
								<strong>
									{__('Due Date:', 'fair-audience')}
								</strong>{' '}
								{fee.due_date || '—'}
							</div>
							<div>
								<strong>
									{__('Status:', 'fair-audience')}
								</strong>{' '}
								{fee.status}
							</div>
						</div>
					</CardBody>
				</Card>
			)}

			{/* Payments Table */}
			<Card>
				<CardBody>
					<div
						style={{
							marginBottom: '16px',
							display: 'flex',
							gap: '8px',
						}}
					>
						<Button
							variant="secondary"
							onClick={handleSendReminders}
							disabled={isSendingReminders}
							isBusy={isSendingReminders}
						>
							{__('Send Reminders', 'fair-audience')}
						</Button>
					</div>

					<DataViews
						data={payments}
						fields={fields}
						view={view}
						onChangeView={setView}
						actions={actions}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading}
						getItemId={(item) => item.id}
					/>
				</CardBody>
			</Card>

			{/* Adjust Amount Modal */}
			{isAdjustModalOpen && adjustingPayment && (
				<Modal
					title={__('Adjust Amount', 'fair-audience')}
					onRequestClose={() => {
						setIsAdjustModalOpen(false);
						setAdjustingPayment(null);
					}}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<p>
						{__('Current amount:', 'fair-audience')}{' '}
						<strong>
							{parseFloat(adjustingPayment.amount).toFixed(2)}
						</strong>
					</p>

					<TextControl
						label={__('New Amount', 'fair-audience')}
						type="number"
						value={newAmount}
						onChange={setNewAmount}
						min="0"
						step="0.01"
					/>

					<TextareaControl
						label={__('Reason (required)', 'fair-audience')}
						value={adjustReason}
						onChange={setAdjustReason}
						placeholder={__(
							'Explain why the amount is being adjusted...',
							'fair-audience'
						)}
					/>

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => {
								setIsAdjustModalOpen(false);
								setAdjustingPayment(null);
							}}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleAdjustAmount}
							disabled={!adjustReason.trim() || isSaving}
							isBusy={isSaving}
						>
							{__('Adjust', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}

			{/* Payment Attempts Modal */}
			{isTransactionsModalOpen && (
				<Modal
					title={__('Payment Attempts', 'fair-audience')}
					onRequestClose={() => setIsTransactionsModalOpen(false)}
					style={{ maxWidth: '640px', width: '100%' }}
				>
					{transactionsLoading ? (
						<Spinner />
					) : transactionEntries.length === 0 ? (
						<p>
							{__('No payment attempts found.', 'fair-audience')}
						</p>
					) : (
						<div
							style={{
								maxHeight: '400px',
								overflowY: 'auto',
							}}
						>
							{transactionEntries.map((entry) => {
								const statusColors = {
									paid: '#00a32a',
									failed: '#d63638',
									canceled: '#d63638',
									expired: '#d63638',
									pending_payment: '#dba617',
									draft: '#757575',
								};
								return (
									<div
										key={entry.id}
										style={{
											padding: '12px',
											borderBottom: '1px solid #eee',
										}}
									>
										<div
											style={{
												display: 'flex',
												justifyContent: 'space-between',
												marginBottom: '4px',
											}}
										>
											<span
												style={{
													color:
														statusColors[
															entry.status
														] || '#333',
													fontWeight: 'bold',
												}}
											>
												{entry.status ||
													__(
														'unknown',
														'fair-audience'
													)}
											</span>
											<span
												style={{
													color: '#666',
													fontSize: '12px',
												}}
											>
												{entry.created_at}
											</span>
										</div>
										<div
											style={{
												fontSize: '13px',
												color: '#555',
											}}
										>
											{__(
												'Transaction:',
												'fair-audience'
											)}{' '}
											#{entry.transaction_id}
											{entry.amount && (
												<>
													{' — '}
													{parseFloat(
														entry.amount
													).toFixed(2)}{' '}
													{entry.currency || 'EUR'}
												</>
											)}
										</div>
										{entry.payment_initiated_at && (
											<div
												style={{
													fontSize: '12px',
													color: '#888',
													marginTop: '4px',
												}}
											>
												{__(
													'Initiated:',
													'fair-audience'
												)}{' '}
												{entry.payment_initiated_at}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setIsTransactionsModalOpen(false)}
						>
							{__('Close', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}

			{/* Audit Log Modal */}
			{isAuditModalOpen && (
				<Modal
					title={__('Audit Log', 'fair-audience')}
					onRequestClose={() => setIsAuditModalOpen(false)}
					style={{ maxWidth: '640px', width: '100%' }}
				>
					{auditLoading ? (
						<Spinner />
					) : auditEntries.length === 0 ? (
						<p>
							{__('No audit log entries found.', 'fair-audience')}
						</p>
					) : (
						<div
							style={{
								maxHeight: '400px',
								overflowY: 'auto',
							}}
						>
							{auditEntries.map((entry) => (
								<div
									key={entry.id}
									style={{
										padding: '12px',
										borderBottom: '1px solid #eee',
									}}
								>
									<div
										style={{
											display: 'flex',
											justifyContent: 'space-between',
											marginBottom: '4px',
										}}
									>
										<strong>
											{entry.action.replace(/_/g, ' ')}
										</strong>
										<span
											style={{
												color: '#666',
												fontSize: '12px',
											}}
										>
											{entry.created_at}
										</span>
									</div>
									{(entry.old_value || entry.new_value) && (
										<div
											style={{
												fontSize: '13px',
												color: '#555',
											}}
										>
											{entry.old_value} →{' '}
											{entry.new_value}
										</div>
									)}
									{entry.comment && (
										<div
											style={{
												fontSize: '13px',
												fontStyle: 'italic',
												color: '#555',
												marginTop: '4px',
											}}
										>
											{entry.comment}
										</div>
									)}
									<div
										style={{
											fontSize: '12px',
											color: '#888',
											marginTop: '4px',
										}}
									>
										{__('By:', 'fair-audience')}{' '}
										{entry.performed_by_name ||
											entry.performed_by}
									</div>
								</div>
							))}
						</div>
					)}

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setIsAuditModalOpen(false)}
						>
							{__('Close', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
