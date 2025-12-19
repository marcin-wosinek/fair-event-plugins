/**
 * Transactions List Component
 *
 * Displays payment transactions for a specific user fee
 */

import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Spinner, Notice } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

const TransactionsList = ({ userFeeId }) => {
	const [transactions, setTransactions] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		fetchTransactions();
	}, [userFeeId]);

	const fetchTransactions = async () => {
		setIsLoading(true);
		setError(null);

		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/user-fees/${userFeeId}/transactions`,
			});

			setTransactions(response);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to load transactions. Please try again.',
						'fair-membership'
					)
			);
		} finally {
			setIsLoading(false);
		}
	};

	const formatDate = (dateString) => {
		if (!dateString) return '-';
		const date = new Date(dateString);
		return date.toLocaleString();
	};

	const getStatusStyle = (status) => {
		const styles = {
			draft: { backgroundColor: '#dcdcde', color: '#000' },
			pending_payment: { backgroundColor: '#2271b1', color: '#fff' },
			paid: { backgroundColor: '#00a32a', color: '#fff' },
			failed: { backgroundColor: '#d63638', color: '#fff' },
			expired: { backgroundColor: '#dba617', color: '#fff' },
			canceled: { backgroundColor: '#787c82', color: '#fff' },
		};

		return styles[status] || {};
	};

	const getStatusLabel = (status) => {
		const labels = {
			draft: __('Draft', 'fair-membership'),
			pending_payment: __('Pending Payment', 'fair-membership'),
			paid: __('Paid', 'fair-membership'),
			failed: __('Failed', 'fair-membership'),
			expired: __('Expired', 'fair-membership'),
			canceled: __('Canceled', 'fair-membership'),
		};

		return labels[status] || status;
	};

	if (isLoading) {
		return (
			<div style={{ textAlign: 'center', padding: '20px' }}>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<Notice status="error" isDismissible={false}>
				{error}
			</Notice>
		);
	}

	if (transactions.length === 0) {
		return (
			<Notice status="info" isDismissible={false}>
				{__(
					'No payment transactions found for this fee.',
					'fair-membership'
				)}
			</Notice>
		);
	}

	return (
		<div className="transactions-list">
			<h3>{__('Payment Transactions', 'fair-membership')}</h3>
			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th>{__('ID', 'fair-membership')}</th>
						<th>{__('Mollie Payment ID', 'fair-membership')}</th>
						<th>{__('Amount', 'fair-membership')}</th>
						<th>{__('Status', 'fair-membership')}</th>
						<th>{__('Created', 'fair-membership')}</th>
						<th>{__('Payment Initiated', 'fair-membership')}</th>
					</tr>
				</thead>
				<tbody>
					{transactions.map((transaction) => (
						<tr key={transaction.id}>
							<td>{transaction.id}</td>
							<td>
								{transaction.mollie_payment_id ? (
									<a
										href={`https://www.mollie.com/dashboard/payments/${transaction.mollie_payment_id}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										{transaction.mollie_payment_id}
									</a>
								) : (
									'-'
								)}
							</td>
							<td>
								€{parseFloat(transaction.amount).toFixed(2)}
							</td>
							<td>
								<span
									style={{
										...getStatusStyle(transaction.status),
										padding: '4px 8px',
										borderRadius: '3px',
										fontSize: '12px',
										fontWeight: 'bold',
										display: 'inline-block',
									}}
								>
									{getStatusLabel(transaction.status)}
								</span>
							</td>
							<td>{formatDate(transaction.created_at)}</td>
							<td>
								{formatDate(transaction.payment_initiated_at)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

export default TransactionsList;
