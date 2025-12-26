/**
 * Transactions Page Component
 */
import { useState, useEffect } from '@wordpress/element';
import { DataViews } from '@wordpress/dataviews/wp';
import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { Spinner, Notice } from '@wordpress/components';

const STATUSES = {
	draft: __('Draft', 'fair-payment'),
	pending_payment: __('Pending Payment', 'fair-payment'),
	open: __('Open', 'fair-payment'),
	pending: __('Pending', 'fair-payment'),
	paid: __('Paid', 'fair-payment'),
	failed: __('Failed', 'fair-payment'),
	canceled: __('Canceled', 'fair-payment'),
	expired: __('Expired', 'fair-payment'),
};

const STATUS_COLORS = {
	paid: { color: '#007017', label: __('Paid', 'fair-payment') },
	failed: { color: '#d63638', label: __('Failed', 'fair-payment') },
	canceled: { color: '#d63638', label: __('Canceled', 'fair-payment') },
	expired: { color: '#d63638', label: __('Expired', 'fair-payment') },
	open: { color: '#996800', label: __('Open', 'fair-payment') },
	pending: { color: '#996800', label: __('Pending', 'fair-payment') },
	pending_payment: {
		color: '#996800',
		label: __('Pending Payment', 'fair-payment'),
	},
	draft: { color: '#666', label: __('Draft', 'fair-payment') },
};

const TransactionsPage = () => {
	const [transactions, setTransactions] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [paginationInfo, setPaginationInfo] = useState({
		totalItems: 0,
		totalPages: 0,
	});

	const [view, setView] = useState({
		type: 'table',
		perPage: 20,
		page: 1,
		sort: {
			field: 'id',
			direction: 'desc',
		},
		search: '',
		filters: [],
		hiddenFields: [],
		layout: {},
	});

	// Fetch transactions
	useEffect(() => {
		const fetchTransactions = async () => {
			setIsLoading(true);
			setError(null);

			try {
				const response = await apiFetch({
					path: `/fair-payment/v1/transactions?page=${view.page}&per_page=${view.perPage}`,
					parse: false,
				});

				const data = await response.json();
				const total = parseInt(response.headers.get('X-WP-Total'), 10);
				const totalPages = parseInt(
					response.headers.get('X-WP-TotalPages'),
					10
				);

				setTransactions(data);
				setPaginationInfo({
					totalItems: total,
					totalPages: totalPages,
				});
			} catch (err) {
				setError(
					err.message ||
						__('Failed to fetch transactions', 'fair-payment')
				);
			} finally {
				setIsLoading(false);
			}
		};

		fetchTransactions();
	}, [view.page, view.perPage]);

	// Define fields/columns
	const fields = [
		{
			id: 'id',
			header: __('ID', 'fair-payment'),
			getValue: ({ item }) => item.id,
			render: ({ item }) => <strong>#{item.id}</strong>,
			enableHiding: false,
			enableSorting: true,
		},
		{
			id: 'mollie_payment_id',
			header: __('Mollie ID', 'fair-payment'),
			getValue: ({ item }) => item.mollie_payment_id || '-',
			render: ({ item }) => {
				if (!item.mollie_payment_id) {
					return <code>-</code>;
				}
				return (
					<a
						href={item.mollie_url}
						target="_blank"
						rel="noopener noreferrer"
						title={__('View in Mollie Dashboard', 'fair-payment')}
					>
						<code>{item.mollie_payment_id}</code>
					</a>
				);
			},
			enableHiding: false,
			enableSorting: false,
		},
		{
			id: 'amount',
			header: __('Amount', 'fair-payment'),
			getValue: ({ item }) => item.amount,
			render: ({ item }) => (
				<>
					<strong>{parseFloat(item.amount).toFixed(2)}</strong>{' '}
					{item.currency}
				</>
			),
			enableHiding: false,
			enableSorting: true,
		},
		{
			id: 'status',
			header: __('Status', 'fair-payment'),
			getValue: ({ item }) => item.status,
			render: ({ item }) => {
				const statusConfig = STATUS_COLORS[item.status] || {
					color: '#666',
					label: item.status,
				};
				return (
					<span
						style={{
							color: statusConfig.color,
							fontWeight: 'bold',
						}}
					>
						{statusConfig.label}
					</span>
				);
			},
			elements: Object.entries(STATUSES).map(([value, label]) => ({
				value,
				label,
			})),
			filterBy: {
				operators: ['is', 'isNot'],
			},
			enableHiding: false,
			enableSorting: true,
		},
		{
			id: 'testmode',
			header: __('Mode', 'fair-payment'),
			getValue: ({ item }) => (item.testmode ? 'test' : 'live'),
			render: ({ item }) => {
				const isTest = item.testmode;
				return (
					<span
						style={{
							color: isTest ? '#996800' : '#007017',
							fontWeight: 'bold',
						}}
					>
						{isTest
							? __('Test', 'fair-payment')
							: __('Live', 'fair-payment')}
					</span>
				);
			},
			elements: [
				{ value: 'test', label: __('Test', 'fair-payment') },
				{ value: 'live', label: __('Live', 'fair-payment') },
			],
			filterBy: {
				operators: ['is'],
			},
			enableHiding: true,
			enableSorting: false,
		},
		{
			id: 'description',
			header: __('Description', 'fair-payment'),
			getValue: ({ item }) => item.description || '',
			enableHiding: true,
			enableSorting: false,
		},
		{
			id: 'user_display_name',
			header: __('User', 'fair-payment'),
			getValue: ({ item }) => item.user_display_name,
			enableHiding: true,
			enableSorting: false,
		},
		{
			id: 'created_at',
			header: __('Date', 'fair-payment'),
			getValue: ({ item }) => item.created_at,
			render: ({ item }) => {
				if (!item.created_at) {
					return '-';
				}
				const date = new Date(item.created_at);
				return date.toLocaleString();
			},
			enableHiding: true,
			enableSorting: true,
		},
	];

	// Define actions (optional - for future use)
	const actions = [];

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Payment Transactions', 'fair-payment')}</h1>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Payment Transactions', 'fair-payment')}</h1>

			{isLoading && transactions.length === 0 ? (
				<div style={{ padding: '40px', textAlign: 'center' }}>
					<Spinner />
				</div>
			) : (
				<DataViews
					data={transactions}
					fields={fields}
					view={view}
					onChangeView={setView}
					actions={actions}
					paginationInfo={paginationInfo}
					supportedLayouts={['table', 'grid', 'list']}
				/>
			)}
		</div>
	);
};

export default TransactionsPage;
