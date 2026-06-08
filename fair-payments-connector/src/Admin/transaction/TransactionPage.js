/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	TextControl,
	__experimentalHeading as Heading,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import TransactionLog from './TransactionLog.js';

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

const EditableField = ({ label, value, displayContent, fieldName, onSave }) => {
	const [editing, setEditing] = useState(false);
	const [inputValue, setInputValue] = useState(String(value || ''));
	const [saving, setSaving] = useState(false);

	const handleSave = () => {
		setSaving(true);
		onSave(fieldName, inputValue ? parseInt(inputValue, 10) : 0)
			.then(() => {
				setEditing(false);
			})
			.finally(() => {
				setSaving(false);
			});
	};

	const handleCancel = () => {
		setInputValue(String(value || ''));
		setEditing(false);
	};

	if (editing) {
		return (
			<DetailRow label={label}>
				<HStack spacing={2} alignment="center" wrap>
					<TextControl
						value={inputValue}
						onChange={setInputValue}
						type="number"
						min="0"
						style={{ width: '100px', margin: 0 }}
						__nextHasNoMarginBottom
					/>
					<Button
						variant="primary"
						size="small"
						onClick={handleSave}
						isBusy={saving}
						disabled={saving}
					>
						{__('Save', 'fair-payments-connector')}
					</Button>
					<Button
						variant="tertiary"
						size="small"
						onClick={handleCancel}
						disabled={saving}
					>
						{__('Cancel', 'fair-payments-connector')}
					</Button>
				</HStack>
			</DetailRow>
		);
	}

	return (
		<DetailRow label={label}>
			<HStack spacing={2} alignment="center">
				<span>{displayContent}</span>
				<Button
					variant="tertiary"
					size="small"
					onClick={() => setEditing(true)}
					style={{ minWidth: 'auto' }}
				>
					{value
						? __('Edit', 'fair-payments-connector')
						: __('Add', 'fair-payments-connector')}
				</Button>
			</HStack>
		</DetailRow>
	);
};

const ParticipantField = ({ participant, participantId, onSave }) => {
	const [editing, setEditing] = useState(false);
	const [search, setSearch] = useState('');
	const [results, setResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [saving, setSaving] = useState(false);
	const debounceRef = useRef(null);

	useEffect(() => {
		if (!editing || search.length < 2) {
			setResults([]);
			return;
		}

		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setSearching(true);
			apiFetch({
				path: `/fair-audience/v1/participants?search=${encodeURIComponent(
					search
				)}&per_page=10`,
			})
				.then((response) => {
					setResults(
						Array.isArray(response)
							? response
							: response.participants || []
					);
				})
				.catch(() => {
					setResults([]);
				})
				.finally(() => {
					setSearching(false);
				});
		}, 300);

		return () => clearTimeout(debounceRef.current);
	}, [search, editing]);

	const handleSelect = (selected) => {
		setSaving(true);
		onSave('participant_id', selected.id)
			.then(() => {
				setEditing(false);
				setSearch('');
				setResults([]);
			})
			.finally(() => {
				setSaving(false);
			});
	};

	const handleClear = () => {
		setSaving(true);
		onSave('participant_id', 0)
			.then(() => {
				setEditing(false);
				setSearch('');
				setResults([]);
			})
			.finally(() => {
				setSaving(false);
			});
	};

	const handleCancel = () => {
		setEditing(false);
		setSearch('');
		setResults([]);
	};

	if (editing) {
		return (
			<DetailRow label={__('Participant', 'fair-payments-connector')}>
				<div style={{ position: 'relative' }}>
					<HStack spacing={2} alignment="center" wrap>
						<TextControl
							value={search}
							onChange={setSearch}
							placeholder={__(
								'Search by name or email…',
								'fair-payments-connector'
							)}
							style={{ width: '250px', margin: 0 }}
							__nextHasNoMarginBottom
						/>
						{participantId > 0 && (
							<Button
								variant="tertiary"
								size="small"
								isDestructive
								onClick={handleClear}
								disabled={saving}
							>
								{__('Remove', 'fair-payments-connector')}
							</Button>
						)}
						<Button
							variant="tertiary"
							size="small"
							onClick={handleCancel}
							disabled={saving}
						>
							{__('Cancel', 'fair-payments-connector')}
						</Button>
					</HStack>
					{(results.length > 0 || searching) && (
						<div
							style={{
								position: 'absolute',
								top: '100%',
								left: 0,
								zIndex: 100,
								background: '#fff',
								border: '1px solid #ccc',
								borderRadius: '4px',
								boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
								width: '350px',
								maxHeight: '250px',
								overflowY: 'auto',
							}}
						>
							{searching && (
								<div style={{ padding: '8px 12px' }}>
									<Spinner />
								</div>
							)}
							{results.map((p) => (
								<button
									key={p.id}
									type="button"
									onClick={() => handleSelect(p)}
									disabled={saving}
									style={{
										display: 'block',
										width: '100%',
										textAlign: 'left',
										padding: '8px 12px',
										border: 'none',
										background: saving
											? '#f0f0f0'
											: 'transparent',
										cursor: saving ? 'default' : 'pointer',
										borderBottom: '1px solid #f0f0f0',
									}}
									onMouseEnter={(e) => {
										if (!saving)
											e.currentTarget.style.background =
												'#f0f6fc';
									}}
									onMouseLeave={(e) => {
										if (!saving)
											e.currentTarget.style.background =
												'transparent';
									}}
								>
									<strong>
										{p.name} {p.surname}
									</strong>
									{p.email && (
										<span
											style={{
												color: '#646970',
												marginLeft: '8px',
											}}
										>
											{p.email}
										</span>
									)}
								</button>
							))}
						</div>
					)}
				</div>
			</DetailRow>
		);
	}

	return (
		<DetailRow label={__('Participant', 'fair-payments-connector')}>
			<HStack spacing={2} alignment="center">
				<span>
					{participant ? (
						<a href={participant.admin_url}>
							{participant.name ||
								participant.email ||
								`#${participant.id}`}
						</a>
					) : (
						'-'
					)}
				</span>
				<Button
					variant="tertiary"
					size="small"
					onClick={() => setEditing(true)}
					style={{ minWidth: 'auto' }}
				>
					{participantId
						? __('Edit', 'fair-payments-connector')
						: __('Add', 'fair-payments-connector')}
				</Button>
			</HStack>
		</DetailRow>
	);
};

const PersonPostCard = ({ transaction: t, onUpdate, transactionId }) => {
	const [error, setError] = useState(null);

	const handleSave = (fieldName, value) => {
		setError(null);
		return apiFetch({
			path: `/fair-payments-connector/v1/transactions/${transactionId}`,
			method: 'POST',
			data: { [fieldName]: value },
		})
			.then((data) => {
				onUpdate(data);
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to update.', 'fair-payments-connector')
				);
				throw err;
			});
	};

	return (
		<Card>
			<CardHeader>
				<Heading level={4}>
					{__('Person & Post', 'fair-payments-connector')}
				</Heading>
			</CardHeader>
			{error && (
				<CardBody style={{ paddingBottom: 0 }}>
					<Notice
						status="error"
						isDismissible
						onRemove={() => setError(null)}
					>
						{error}
					</Notice>
				</CardBody>
			)}
			<CardBody>
				<table>
					<tbody>
						<ParticipantField
							participant={t.participant}
							participantId={t.participant_id}
							onSave={handleSave}
						/>
						<EditableField
							label={__('User', 'fair-payments-connector')}
							value={t.user_id}
							displayContent={
								t.user_id ? (
									<a
										href={`user-edit.php?user_id=${t.user_id}`}
									>
										{t.user_name || `#${t.user_id}`}
									</a>
								) : (
									'-'
								)
							}
							fieldName="user_id"
							onSave={handleSave}
						/>
						<EditableField
							label={__('Post', 'fair-payments-connector')}
							value={t.post_id}
							displayContent={
								t.post_id ? (
									<a
										href={`post.php?post=${t.post_id}&action=edit`}
									>
										{t.post_title || `#${t.post_id}`}
									</a>
								) : (
									'-'
								)
							}
							fieldName="post_id"
							onSave={handleSave}
						/>
					</tbody>
				</table>
			</CardBody>
		</Card>
	);
};

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
			path: `/fair-payments-connector/v1/transactions/${transactionId}/sync-mollie`,
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
									'fair-payments-connector'
							  )
							: __(
									'Mollie responded but the settlement fee could not be extracted. See Mollie response below.',
									'fair-payments-connector'
							  ),
					debug: data.sync_debug || null,
				});
			})
			.catch((err) => {
				setSyncNotice({
					status: 'error',
					message:
						err.message ||
						__(
							'Failed to sync with Mollie.',
							'fair-payments-connector'
						),
				});
			})
			.finally(() => {
				setSyncing(false);
			});
	};

	useEffect(() => {
		if (!transactionId) {
			setError(
				__('No transaction ID provided.', 'fair-payments-connector')
			);
			setLoading(false);
			return;
		}

		apiFetch({
			path: `/fair-payments-connector/v1/transactions/${transactionId}`,
		})
			.then((data) => {
				setTransaction(data);
			})
			.catch((err) => {
				setError(
					err.message ||
						__(
							'Failed to load transaction.',
							'fair-payments-connector'
						)
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
				<h1>{__('Transaction Detail', 'fair-payments-connector')}</h1>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
				<p>
					<a href="admin.php?page=fair-payments-connector-transactions">
						&larr;{' '}
						{__('Back to Transactions', 'fair-payments-connector')}
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
					<a href="admin.php?page=fair-payments-connector-transactions">
						&larr;{' '}
						{__('Back to Transactions', 'fair-payments-connector')}
					</a>
					<h1 style={{ margin: '8px 0 0' }}>
						{__('Transaction', 'fair-payments-connector')} #{t.id}{' '}
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
								{__(
									'Payment Details',
									'fair-payments-connector'
								)}
							</Heading>
							{t.mollie_payment_id && (
								<Button
									variant="secondary"
									onClick={handleSyncMollie}
									isBusy={syncing}
									disabled={syncing}
								>
									{syncing
										? __(
												'Syncing…',
												'fair-payments-connector'
										  )
										: __(
												'Sync with Mollie',
												'fair-payments-connector'
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
									<details style={{ marginTop: '8px' }}>
										<summary
											style={{
												cursor: 'pointer',
												fontSize: '12px',
											}}
										>
											{__(
												'See Mollie response',
												'fair-payments-connector'
											)}
										</summary>
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
									</details>
								)}
							</Notice>
						</CardBody>
					)}
					<CardBody>
						<table>
							<tbody>
								<DetailRow
									label={__(
										'Amount',
										'fair-payments-connector'
									)}
								>
									<strong>{t.amount.toFixed(2)}</strong>{' '}
									{t.currency}
								</DetailRow>
								<DetailRow
									label={__(
										'Mollie Fee',
										'fair-payments-connector'
									)}
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
										'fair-payments-connector'
									)}
								>
									{t.application_fee !== null
										? `${t.application_fee.toFixed(2)} ${
												t.currency
										  }`
										: '-'}
								</DetailRow>
								<DetailRow
									label={__(
										'Mode',
										'fair-payments-connector'
									)}
								>
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
											? __(
													'Test',
													'fair-payments-connector'
											  )
											: __(
													'Live',
													'fair-payments-connector'
											  )}
									</span>
								</DetailRow>
							</tbody>
						</table>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<Heading level={4}>
							{__('Status & Timing', 'fair-payments-connector')}
						</Heading>
					</CardHeader>
					<CardBody>
						<table>
							<tbody>
								<DetailRow
									label={__(
										'Status',
										'fair-payments-connector'
									)}
								>
									<span style={getStatusStyle(t.status)}>
										{t.status.charAt(0).toUpperCase() +
											t.status.slice(1)}
									</span>
								</DetailRow>
								<DetailRow
									label={__(
										'Created',
										'fair-payments-connector'
									)}
								>
									{t.created_at || '-'}
								</DetailRow>
								<DetailRow
									label={__(
										'Payment Initiated',
										'fair-payments-connector'
									)}
								>
									{t.payment_initiated_at || '-'}
								</DetailRow>
								<DetailRow
									label={__(
										'Updated',
										'fair-payments-connector'
									)}
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
								{__('Description', 'fair-payments-connector')}
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
									{__('Metadata', 'fair-payments-connector')}
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
								{__('Line Items', 'fair-payments-connector')}
							</Heading>
						</CardHeader>
						<CardBody>
							<table className="wp-list-table widefat fixed striped">
								<thead>
									<tr>
										<th>
											{__(
												'Name',
												'fair-payments-connector'
											)}
										</th>
										<th>
											{__(
												'Description',
												'fair-payments-connector'
											)}
										</th>
										<th>
											{__(
												'Quantity',
												'fair-payments-connector'
											)}
										</th>
										<th>
											{__(
												'Unit Amount',
												'fair-payments-connector'
											)}
										</th>
										<th>
											{__(
												'Total',
												'fair-payments-connector'
											)}
										</th>
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

				<PersonPostCard
					transaction={t}
					onUpdate={setTransaction}
					transactionId={transactionId}
				/>

				<Card>
					<CardHeader>
						<Heading level={4}>
							{__('URLs & Mollie', 'fair-payments-connector')}
						</Heading>
					</CardHeader>
					<CardBody>
						<table>
							<tbody>
								<DetailRow
									label={__(
										'Mollie Payment ID',
										'fair-payments-connector'
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
									label={__(
										'Redirect URL',
										'fair-payments-connector'
									)}
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
									label={__(
										'Webhook URL',
										'fair-payments-connector'
									)}
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
									label={__(
										'Checkout URL',
										'fair-payments-connector'
									)}
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

				<TransactionLog transactionId={transactionId} />
			</VStack>
		</div>
	);
};

export default TransactionPage;
