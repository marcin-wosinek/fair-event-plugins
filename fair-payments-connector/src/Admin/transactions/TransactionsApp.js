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
	{ label: __( 'All statuses', 'fair-payments-connector' ), value: '' },
	{ label: __( 'Paid', 'fair-payments-connector' ), value: 'paid' },
	{ label: __( 'Pending', 'fair-payments-connector' ), value: 'pending' },
	{ label: __( 'Open', 'fair-payments-connector' ), value: 'open' },
	{ label: __( 'Failed', 'fair-payments-connector' ), value: 'failed' },
	{ label: __( 'Canceled', 'fair-payments-connector' ), value: 'canceled' },
	{ label: __( 'Expired', 'fair-payments-connector' ), value: 'expired' },
	{ label: __( 'Draft', 'fair-payments-connector' ), value: 'draft' },
	{
		label: __( 'Pending payment', 'fair-payments-connector' ),
		value: 'pending_payment',
	},
];

const MODE_OPTIONS = [
	{ label: __( 'Live', 'fair-payments-connector' ), value: 'live' },
	{ label: __( 'Test', 'fair-payments-connector' ), value: 'test' },
	{ label: __( 'All modes', 'fair-payments-connector' ), value: '' },
];

const getStatusStyle = ( status ) => {
	switch ( status ) {
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

const getModeStyle = ( testmode ) => {
	return testmode
		? { color: '#996800', fontWeight: 'bold' }
		: { color: '#007017', fontWeight: 'bold' };
};

const TransactionsApp = () => {
	const [ transactions, setTransactions ] = useState( [] );
	const [ pagination, setPagination ] = useState( {
		total: 0,
		pages: 0,
		page: 1,
	} );
	const [ filters, setFilters ] = useState( {
		status: 'paid',
		mode: 'live',
	} );
	const [ sort, setSort ] = useState( {
		orderby: 'created_at',
		order: 'desc',
	} );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ selectedTransactions, setSelectedTransactions ] = useState(
		new Set()
	);
	const [ isImportModalOpen, setIsImportModalOpen ] = useState( false );

	// One-use success marker set by the transaction detail page after a
	// deletion redirect; shown once and stripped so a refresh doesn't repeat it.
	useEffect( () => {
		const params = new URLSearchParams( window.location.search );
		if ( ! params.get( 'transaction_deleted' ) ) {
			return;
		}

		setSuccess(
			__(
				'Transaction deleted. The payment in Mollie or any other external service was not changed.',
				'fair-payments-connector'
			)
		);

		params.delete( 'transaction_deleted' );
		const query = params.toString();
		window.history.replaceState(
			{},
			'',
			window.location.pathname +
				( query ? `?${ query }` : '' ) +
				window.location.hash
		);
	}, [] );

	const loadTransactions = useCallback( async () => {
		setLoading( true );
		setError( null );

		try {
			const params = new URLSearchParams();
			params.append( 'page', pagination.page );
			params.append( 'per_page', 50 );
			if ( filters.status ) params.append( 'status', filters.status );
			if ( filters.mode ) params.append( 'mode', filters.mode );
			params.append( 'orderby', sort.orderby );
			params.append( 'order', sort.order );

			const data = await apiFetch( {
				path: `/fair-payments-connector/v1/transactions?${ params.toString() }`,
			} );

			setTransactions( data.transactions );
			setPagination( ( prev ) => ( {
				...prev,
				total: data.total,
				pages: data.pages,
			} ) );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to load transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setLoading( false );
		}
	}, [ filters, pagination.page, sort ] );

	useEffect( () => {
		loadTransactions();
	}, [ loadTransactions ] );

	const handleSort = ( column ) => {
		setSort( ( prev ) => ( {
			orderby: column,
			order:
				prev.orderby === column && prev.order === 'desc'
					? 'asc'
					: 'desc',
		} ) );
	};

	const getSortIndicator = ( column ) => {
		if ( sort.orderby !== column ) return '';
		return sort.order === 'asc' ? ' \u25B2' : ' \u25BC';
	};

	const toggleTransactionSelection = ( id ) => {
		setSelectedTransactions( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			return next;
		} );
	};

	const toggleAllTransactions = () => {
		if ( selectedTransactions.size === transactions.length ) {
			setSelectedTransactions( new Set() );
		} else {
			setSelectedTransactions(
				new Set( transactions.map( ( t ) => t.id ) )
			);
		}
	};

	const handleExport = () => {
		const sourceDomain = window.location.hostname;

		const toExport = transactions
			.filter( ( t ) => selectedTransactions.has( t.id ) )
			.map( ( t ) => ( {
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
			} ) );

		const blob = new Blob( [ JSON.stringify( toExport, null, 2 ) ], {
			type: 'application/json',
		} );
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = 'transactions.json';
		a.click();
		URL.revokeObjectURL( url );
		setSuccess(
			// translators: %d is the number of exported transactions
			__(
				'%d transaction(s) exported.',
				'fair-payments-connector'
			).replace( '%d', toExport.length )
		);
	};

	const handleImported = ( message ) => {
		setError( null );
		setSuccess( message );
		setIsImportModalOpen( false );
		loadTransactions();
	};

	const sortableHeader = ( column, label ) => (
		<th
			style={ { cursor: 'pointer' } }
			onClick={ () => handleSort( column ) }
		>
			{ label }
			{ getSortIndicator( column ) }
		</th>
	);

	return (
		<div className="wrap">
			<h1>{ __( 'Payment Transactions', 'fair-payments-connector' ) }</h1>

			<Card>
				<CardHeader>
					<HStack
						justify="space-between"
						wrap
						style={ { rowGap: '8px' } }
					>
						<HStack>
							<SelectControl
								label={ __(
									'Status',
									'fair-payments-connector'
								) }
								value={ filters.status }
								options={ STATUS_OPTIONS }
								onChange={ ( value ) => {
									setFilters( ( prev ) => ( {
										...prev,
										status: value,
									} ) );
									setPagination( ( prev ) => ( {
										...prev,
										page: 1,
									} ) );
								} }
								__nextHasNoMarginBottom
							/>
							<SelectControl
								label={ __(
									'Mode',
									'fair-payments-connector'
								) }
								value={ filters.mode }
								options={ MODE_OPTIONS }
								onChange={ ( value ) => {
									setFilters( ( prev ) => ( {
										...prev,
										mode: value,
									} ) );
									setPagination( ( prev ) => ( {
										...prev,
										page: 1,
									} ) );
								} }
								__nextHasNoMarginBottom
							/>
						</HStack>
						<HStack
							spacing={ 2 }
							expanded={ false }
							wrap
							style={ { rowGap: '8px' } }
						>
							{ selectedTransactions.size > 0 && (
								<Button
									variant="secondary"
									onClick={ handleExport }
									style={ { flexShrink: 0, width: 'auto' } }
								>
									{ __(
										'Export Selected',
										'fair-payments-connector'
									) }
								</Button>
							) }
							<Button
								variant="secondary"
								onClick={ () => setIsImportModalOpen( true ) }
								style={ { flexShrink: 0, width: 'auto' } }
							>
								{ __( 'Import', 'fair-payments-connector' ) }
							</Button>
						</HStack>
					</HStack>
				</CardHeader>
				<CardBody style={ { overflowX: 'auto' } }>
					{ error && (
						<Notice
							status="error"
							isDismissible
							onRemove={ () => setError( null ) }
						>
							{ error }
						</Notice>
					) }

					{ success && (
						<Notice
							status="success"
							isDismissible
							onRemove={ () => setSuccess( null ) }
						>
							{ success }
						</Notice>
					) }

					{ loading ? (
						<Spinner />
					) : transactions.length === 0 ? (
						<p>
							{ __(
								'No transactions found.',
								'fair-payments-connector'
							) }
						</p>
					) : (
						<>
							<table
								className="wp-list-table widefat striped"
								style={ { whiteSpace: 'nowrap' } }
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
												onChange={
													toggleAllTransactions
												}
											/>
										</td>
										{ sortableHeader(
											'id',
											__(
												'ID',
												'fair-payments-connector'
											)
										) }
										{ sortableHeader(
											'amount',
											__(
												'Amount',
												'fair-payments-connector'
											)
										) }
										<th>
											{ __(
												'Mollie Fee',
												'fair-payments-connector'
											) }
										</th>
										<th>
											{ __(
												'Integration Fee',
												'fair-payments-connector'
											) }
										</th>
										{ sortableHeader(
											'status',
											__(
												'Status',
												'fair-payments-connector'
											)
										) }
										<th>
											{ __(
												'Mode',
												'fair-payments-connector'
											) }
										</th>
										<th
											style={ {
												maxWidth: '200px',
												whiteSpace: 'normal',
											} }
										>
											{ __(
												'Description',
												'fair-payments-connector'
											) }
										</th>
										<th>
											{ __(
												'Person',
												'fair-payments-connector'
											) }
										</th>
										<th>
											{ __(
												'Entry',
												'fair-payments-connector'
											) }
										</th>
										{ sortableHeader(
											'created_at',
											__(
												'Date',
												'fair-payments-connector'
											)
										) }
									</tr>
								</thead>
								<tbody>
									{ transactions.map( ( t ) => (
										<tr key={ t.id }>
											<th className="check-column">
												<input
													type="checkbox"
													checked={ selectedTransactions.has(
														t.id
													) }
													onChange={ () =>
														toggleTransactionSelection(
															t.id
														)
													}
												/>
											</th>
											<td>
												<a
													href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ t.id }` }
												>
													{ t.id }
												</a>
											</td>
											<td>
												<strong>
													{ t.amount.toFixed( 2 ) }
												</strong>{ ' ' }
												{ t.currency }
											</td>
											<td>
												{ t.mollie_fee !== null
													? `${ t.mollie_fee.toFixed(
															2
													  ) } ${ t.currency }`
													: '-' }
											</td>
											<td>
												{ t.application_fee !== null
													? `${ t.application_fee.toFixed(
															2
													  ) } ${ t.currency }`
													: '-' }
											</td>
											<td>
												<span
													style={ getStatusStyle(
														t.status
													) }
												>
													{ t.status
														.charAt( 0 )
														.toUpperCase() +
														t.status.slice( 1 ) }
												</span>
											</td>
											<td>
												<span
													style={ getModeStyle(
														t.testmode
													) }
												>
													{ t.testmode
														? __(
																'Test',
																'fair-payments-connector'
														  )
														: __(
																'Live',
																'fair-payments-connector'
														  ) }
												</span>
											</td>
											<td
												style={ {
													maxWidth: '200px',
													whiteSpace: 'normal',
												} }
											>
												{ t.description }
											</td>
											<td>
												{ t.participant ? (
													<a
														href={
															t.participant
																.admin_url
														}
													>
														{ t.participant.name ||
															t.participant
																.email ||
															`#${ t.participant.id }` }
													</a>
												) : (
													t.user_name || '-'
												) }
											</td>
											<td>
												{ t.entry_ids &&
												t.entry_ids.length > 0
													? t.entry_ids
															.map(
																( entryId ) =>
																	`#${ entryId }`
															)
															.join( ', ' )
													: '-' }
											</td>
											<td>{ t.created_at }</td>
										</tr>
									) ) }
								</tbody>
							</table>

							{ pagination.pages > 1 && (
								<HStack
									style={ {
										marginTop: '16px',
										justifyContent: 'center',
									} }
								>
									<Button
										variant="secondary"
										disabled={ pagination.page <= 1 }
										onClick={ () =>
											setPagination( ( prev ) => ( {
												...prev,
												page: prev.page - 1,
											} ) )
										}
									>
										{ __(
											'Previous',
											'fair-payments-connector'
										) }
									</Button>
									<span>
										{ pagination.page } /{ ' ' }
										{ pagination.pages }
									</span>
									<Button
										variant="secondary"
										disabled={
											pagination.page >= pagination.pages
										}
										onClick={ () =>
											setPagination( ( prev ) => ( {
												...prev,
												page: prev.page + 1,
											} ) )
										}
									>
										{ __(
											'Next',
											'fair-payments-connector'
										) }
									</Button>
								</HStack>
							) }
						</>
					) }
				</CardBody>
			</Card>

			{ isImportModalOpen && (
				<ImportTransactionsModal
					onClose={ () => setIsImportModalOpen( false ) }
					onImported={ handleImported }
				/>
			) }
		</div>
	);
};

export default TransactionsApp;
