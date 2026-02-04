/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	TextControl,
	Button,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const MatchModal = ({ entry, onMatch, onCancel }) => {
	const [transactions, setTransactions] = useState([]);
	const [loading, setLoading] = useState(true);
	const [matching, setMatching] = useState(false);
	const [error, setError] = useState(null);
	const [searchTerm, setSearchTerm] = useState('');

	useEffect(() => {
		loadTransactions();
	}, [entry]);

	const loadTransactions = async () => {
		setLoading(true);
		setError(null);

		try {
			// Search for transactions matching the entry amount
			const params = new URLSearchParams();
			if (entry.amount) {
				params.append('amount', entry.amount);
			}

			const data = await apiFetch({
				path: `/fair-payment/v1/transactions/search?${params.toString()}`,
			});
			setTransactions(data);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load transactions.', 'fair-payment')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			if (searchTerm) {
				params.append('search', searchTerm);
			}
			if (entry.amount) {
				params.append('amount', entry.amount);
			}

			const data = await apiFetch({
				path: `/fair-payment/v1/transactions/search?${params.toString()}`,
			});
			setTransactions(data);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to search transactions.', 'fair-payment')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleMatch = async (transactionId) => {
		setMatching(true);
		setError(null);

		try {
			await apiFetch({
				path: `/fair-payment/v1/financial-entries/${entry.id}/match`,
				method: 'POST',
				data: { transaction_id: transactionId },
			});
			onMatch();
		} catch (err) {
			setError(
				err.message ||
					__('Failed to match transaction.', 'fair-payment')
			);
			setMatching(false);
		}
	};

	const formatDate = (dateString) => {
		const date = new Date(dateString);
		return date.toLocaleDateString();
	};

	const formatAmount = (amount, currency = 'EUR') => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency,
		}).format(amount);
	};

	return (
		<Modal
			title={__('Match to Transaction', 'fair-payment')}
			onRequestClose={onCancel}
			style={{ maxWidth: '700px', width: '100%' }}
		>
			<VStack spacing={4}>
				<div
					style={{
						background: '#f0f0f1',
						padding: '12px',
						borderRadius: '4px',
					}}
				>
					<p style={{ margin: 0 }}>
						<strong>{__('Entry:', 'fair-payment')}</strong>{' '}
						{formatAmount(entry.amount)} ({entry.entry_type}) -{' '}
						{entry.entry_date}
						{entry.description && ` - ${entry.description}`}
					</p>
				</div>

				<HStack>
					<TextControl
						label={__('Search', 'fair-payment')}
						value={searchTerm}
						onChange={setSearchTerm}
						placeholder={__(
							'Search by description or Mollie ID...',
							'fair-payment'
						)}
						style={{ flex: 1 }}
					/>
					<Button
						variant="secondary"
						onClick={handleSearch}
						disabled={loading}
						style={{ marginTop: '24px' }}
					>
						{__('Search', 'fair-payment')}
					</Button>
				</HStack>

				{error && (
					<div
						className="notice notice-error"
						style={{ margin: 0, padding: '8px' }}
					>
						{error}
					</div>
				)}

				{loading && (
					<div style={{ textAlign: 'center', padding: '20px' }}>
						<Spinner />
						<p>{__('Loading transactions...', 'fair-payment')}</p>
					</div>
				)}

				{!loading && transactions.length === 0 && (
					<div style={{ textAlign: 'center', padding: '20px' }}>
						<p>
							{__(
								'No matching transactions found. Try adjusting your search.',
								'fair-payment'
							)}
						</p>
					</div>
				)}

				{!loading && transactions.length > 0 && (
					<table
						className="wp-list-table widefat fixed striped"
						style={{ marginTop: 0 }}
					>
						<thead>
							<tr>
								<th>{__('Date', 'fair-payment')}</th>
								<th>{__('Amount', 'fair-payment')}</th>
								<th>{__('Description', 'fair-payment')}</th>
								<th>{__('Mollie ID', 'fair-payment')}</th>
								<th style={{ width: '100px' }}>
									{__('Action', 'fair-payment')}
								</th>
							</tr>
						</thead>
						<tbody>
							{transactions.map((transaction) => (
								<tr key={transaction.id}>
									<td>
										{formatDate(transaction.created_at)}
									</td>
									<td>
										{formatAmount(
											transaction.amount,
											transaction.currency
										)}
									</td>
									<td>
										{transaction.description || (
											<em>
												{__(
													'No description',
													'fair-payment'
												)}
											</em>
										)}
									</td>
									<td>
										<code style={{ fontSize: '11px' }}>
											{transaction.mollie_payment_id}
										</code>
									</td>
									<td>
										<Button
											variant="primary"
											size="small"
											onClick={() =>
												handleMatch(transaction.id)
											}
											disabled={matching}
											isBusy={matching}
										>
											{__('Match', 'fair-payment')}
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}

				<HStack justify="flex-end">
					<Button
						variant="tertiary"
						onClick={onCancel}
						disabled={matching}
					>
						{__('Cancel', 'fair-payment')}
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
};

export default MatchModal;
