/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	SelectControl,
	TextControl,
	Button,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import ImportTransactionsModal from './components/ImportTransactionsModal.js';
import MollieFeeFeedback from '../external-updates/components/MollieFeeFeedback.js';
import useMollieFeeLoad from '../external-updates/useMollieFeeLoad.js';

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

// What the screen shows before the organizer changes anything, and what
// "Reset filters" returns to.
const DEFAULT_CRITERIA = {
	status: 'paid',
	mode: 'live',
	search: '',
	dateFrom: '',
	dateTo: '',
	amountMin: '',
	amountMax: '',
};

const DEFAULT_QUERY = {
	criteria: DEFAULT_CRITERIA,
	page: 1,
	orderby: 'created_at',
	order: 'desc',
};

const EMPTY_RESULT = { transactions: [], total: 0, pages: 0 };

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

const sameCriteria = ( a, b ) =>
	Object.keys( DEFAULT_CRITERIA ).every( ( key ) => a[ key ] === b[ key ] );

const trimCriteria = ( criteria ) => ( {
	...criteria,
	search: criteria.search.trim(),
	amountMin: criteria.amountMin.trim(),
	amountMax: criteria.amountMax.trim(),
} );

const optionLabel = ( options, value ) =>
	options.find( ( option ) => option.value === value )?.label ?? value;

/**
 * Validate criteria the same way the REST endpoint does.
 *
 * @param {Object} criteria Draft criteria.
 * @return {Object} Message per invalid field; empty when the criteria can be applied.
 */
const getCriteriaErrors = ( criteria ) => {
	const errors = {};
	const { amountMin, amountMax, dateFrom, dateTo } = trimCriteria( criteria );

	[
		[ 'amountMin', amountMin ],
		[ 'amountMax', amountMax ],
	].forEach( ( [ key, value ] ) => {
		if ( value !== '' && ! AMOUNT_PATTERN.test( value ) ) {
			errors[ key ] = __(
				'Enter an amount of zero or more with at most two decimal places.',
				'fair-payments-connector'
			);
		}
	} );

	if (
		! errors.amountMin &&
		! errors.amountMax &&
		amountMin !== '' &&
		amountMax !== '' &&
		Number( amountMin ) > Number( amountMax )
	) {
		errors.amountMax = __(
			'The maximum amount must not be less than the minimum amount.',
			'fair-payments-connector'
		);
	}

	if ( dateFrom && dateTo && dateFrom > dateTo ) {
		errors.dateTo = __(
			'The end date must be on or after the start date.',
			'fair-payments-connector'
		);
	}

	return errors;
};

/**
 * One translatable label per applied criterion.
 *
 * @param {Object} criteria Applied criteria.
 * @return {string[]} Labels.
 */
const describeCriteria = ( criteria ) => {
	const labels = [
		sprintf(
			// translators: %s is the selected transaction status, e.g. "Paid".
			__( 'Status: %s', 'fair-payments-connector' ),
			optionLabel( STATUS_OPTIONS, criteria.status )
		),
		sprintf(
			// translators: %s is the selected payment mode, e.g. "Live".
			__( 'Mode: %s', 'fair-payments-connector' ),
			optionLabel( MODE_OPTIONS, criteria.mode )
		),
	];

	if ( criteria.search ) {
		labels.push(
			sprintf(
				// translators: %s is the text the organizer searched for.
				__( 'Search: %s', 'fair-payments-connector' ),
				criteria.search
			)
		);
	}
	if ( criteria.dateFrom ) {
		labels.push(
			sprintf(
				// translators: %s is a date, e.g. 2026-03-01.
				__( 'From %s', 'fair-payments-connector' ),
				criteria.dateFrom
			)
		);
	}
	if ( criteria.dateTo ) {
		labels.push(
			sprintf(
				// translators: %s is a date, e.g. 2026-03-31.
				__( 'Until %s', 'fair-payments-connector' ),
				criteria.dateTo
			)
		);
	}
	if ( criteria.amountMin !== '' ) {
		labels.push(
			sprintf(
				// translators: %s is an amount, e.g. 10.00.
				__( 'Amount at least %s', 'fair-payments-connector' ),
				criteria.amountMin
			)
		);
	}
	if ( criteria.amountMax !== '' ) {
		labels.push(
			sprintf(
				// translators: %s is an amount, e.g. 50.00.
				__( 'Amount at most %s', 'fair-payments-connector' ),
				criteria.amountMax
			)
		);
	}

	return labels;
};

const buildListPath = ( { criteria, page, orderby, order } ) => {
	const params = new URLSearchParams();
	params.append( 'page', page );
	params.append( 'per_page', 50 );
	[
		[ 'status', criteria.status ],
		[ 'mode', criteria.mode ],
		[ 'search', criteria.search ],
		[ 'date_from', criteria.dateFrom ],
		[ 'date_to', criteria.dateTo ],
		[ 'amount_min', criteria.amountMin ],
		[ 'amount_max', criteria.amountMax ],
	].forEach( ( [ name, value ] ) => {
		if ( value !== '' ) {
			params.append( name, value );
		}
	} );
	params.append( 'orderby', orderby );
	params.append( 'order', order );

	return `/fair-payments-connector/v1/transactions?${ params.toString() }`;
};

const FILTER_ROW_STYLE = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: '12px',
	alignItems: 'flex-start',
};
const FILTER_FIELD_STYLE = { flex: '1 1 150px', minWidth: '140px' };
const FILTER_SEARCH_STYLE = { flex: '2 1 260px', minWidth: '200px' };
const FIELD_ERROR_STYLE = { color: '#d63638' };

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
	// Draft inputs stay separate from the applied query; only Apply and
	// Reset move them into it.
	const [ draft, setDraft ] = useState( DEFAULT_CRITERIA );
	const [ query, setQuery ] = useState( DEFAULT_QUERY );
	const [ result, setResult ] = useState( EMPTY_RESULT );
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ selectedTransactions, setSelectedTransactions ] = useState(
		new Set()
	);
	const [ isImportModalOpen, setIsImportModalOpen ] = useState( false );
	const [ loadingFees, setLoadingFees ] = useState( false );
	// A ref closes the gap before re-render, so a double click can't start
	// two fee runs.
	const feesBusyRef = useRef( false );
	const queryRef = useRef( query );
	// Identifies the newest list request, so an older response arriving late
	// can't replace newer results.
	const requestRef = useRef( 0 );

	const { transactions } = result;
	const { criteria } = query;
	const draftErrors = getCriteriaErrors( draft );
	const canApply = Object.keys( draftErrors ).length === 0;
	const hasUnappliedChanges = ! sameCriteria(
		trimCriteria( draft ),
		criteria
	);
	const isDefaultCriteria = sameCriteria( criteria, DEFAULT_CRITERIA );

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
		const remaining = params.toString();
		window.history.replaceState(
			{},
			'',
			window.location.pathname +
				( remaining ? `?${ remaining }` : '' ) +
				window.location.hash
		);
	}, [] );

	const loadTransactions = useCallback( async () => {
		const requestId = ++requestRef.current;
		setLoading( true );
		setLoadError( null );

		try {
			const data = await apiFetch( {
				path: buildListPath( queryRef.current ),
			} );
			if ( requestId !== requestRef.current ) {
				return;
			}

			setResult( {
				transactions: data.transactions,
				total: data.total,
				pages: data.pages,
			} );
			// A refresh keeps only the selected rows that are still shown.
			const visibleIds = new Set(
				data.transactions.map( ( t ) => t.id )
			);
			setSelectedTransactions(
				( prev ) =>
					new Set(
						[ ...prev ].filter( ( id ) => visibleIds.has( id ) )
					)
			);
		} catch ( err ) {
			if ( requestId !== requestRef.current ) {
				return;
			}

			setResult( EMPTY_RESULT );
			setSelectedTransactions( new Set() );
			setLoadError(
				err.message ||
					__(
						'Failed to load transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			if ( requestId === requestRef.current ) {
				setLoading( false );
			}
		}
	}, [] );

	useEffect( () => {
		queryRef.current = query;
		loadTransactions();
	}, [ query, loadTransactions ] );

	// Criteria, page and sort changes show different rows, so they drop the
	// selection made on the previous ones.
	const changeQuery = ( changes ) => {
		setSelectedTransactions( new Set() );
		setQuery( ( prev ) => ( { ...prev, ...changes } ) );
	};

	const handleApply = ( event ) => {
		event.preventDefault();
		if ( ! canApply ) {
			return;
		}

		const applied = trimCriteria( draft );
		setDraft( applied );
		changeQuery( { criteria: applied, page: 1 } );
	};

	const handleReset = () => {
		setDraft( DEFAULT_CRITERIA );
		changeQuery( { criteria: DEFAULT_CRITERIA, page: 1 } );
	};

	const setDraftField = ( field ) => ( value ) =>
		setDraft( ( prev ) => ( { ...prev, [ field ]: value } ) );

	const fieldHelp = ( field, help ) =>
		draftErrors[ field ] ? (
			<span style={ FIELD_ERROR_STYLE }>{ draftErrors[ field ] }</span>
		) : (
			help
		);

	// The fee run is logged on External Updates like any other; this page
	// scopes it with the Mode filter and refreshes the list when it ends.
	const feeLoad = useMollieFeeLoad( {
		onBegin: () => {
			if ( feesBusyRef.current ) {
				return false;
			}
			feesBusyRef.current = true;
			setLoadingFees( true );
			return true;
		},
		onEnd: () => {
			feesBusyRef.current = false;
			setLoadingFees( false );
			loadTransactions();
		},
	} );

	const handleSort = ( column ) => {
		changeQuery( {
			orderby: column,
			order:
				query.orderby === column && query.order === 'desc'
					? 'asc'
					: 'desc',
		} );
	};

	const getSortIndicator = ( column ) => {
		if ( query.orderby !== column ) return '';
		return query.order === 'asc' ? ' \u25B2' : ' \u25BC';
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

	const allVisibleSelected =
		transactions.length > 0 &&
		transactions.every( ( t ) => selectedTransactions.has( t.id ) );

	const toggleAllTransactions = () => {
		if ( allVisibleSelected ) {
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
				<CardHeader
					style={ {
						flexDirection: 'column',
						alignItems: 'stretch',
						gap: '16px',
					} }
				>
					<form
						onSubmit={ handleApply }
						noValidate
						aria-label={ __(
							'Filter transactions',
							'fair-payments-connector'
						) }
					>
						<div style={ FILTER_ROW_STYLE }>
							<div style={ FILTER_SEARCH_STYLE }>
								<TextControl
									type="search"
									label={ __(
										'Search',
										'fair-payments-connector'
									) }
									help={ __(
										'Transaction ID, Mollie payment ID, description, or person name or email.',
										'fair-payments-connector'
									) }
									value={ draft.search }
									onChange={ setDraftField( 'search' ) }
									maxLength={ 200 }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<SelectControl
									label={ __(
										'Status',
										'fair-payments-connector'
									) }
									value={ draft.status }
									options={ STATUS_OPTIONS }
									onChange={ setDraftField( 'status' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<SelectControl
									label={ __(
										'Mode',
										'fair-payments-connector'
									) }
									value={ draft.mode }
									options={ MODE_OPTIONS }
									onChange={ setDraftField( 'mode' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<TextControl
									type="date"
									label={ __(
										'From date',
										'fair-payments-connector'
									) }
									value={ draft.dateFrom }
									onChange={ setDraftField( 'dateFrom' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<TextControl
									type="date"
									label={ __(
										'To date',
										'fair-payments-connector'
									) }
									help={ fieldHelp( 'dateTo' ) }
									value={ draft.dateTo }
									onChange={ setDraftField( 'dateTo' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<TextControl
									type="number"
									min={ 0 }
									step="0.01"
									label={ __(
										'Minimum amount',
										'fair-payments-connector'
									) }
									help={ fieldHelp( 'amountMin' ) }
									value={ draft.amountMin }
									onChange={ setDraftField( 'amountMin' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
							<div style={ FILTER_FIELD_STYLE }>
								<TextControl
									type="number"
									min={ 0 }
									step="0.01"
									label={ __(
										'Maximum amount',
										'fair-payments-connector'
									) }
									help={ fieldHelp( 'amountMax' ) }
									value={ draft.amountMax }
									onChange={ setDraftField( 'amountMax' ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							</div>
						</div>
						<p className="description">
							{ __(
								'Dates include the whole day in the site timezone. Amounts are compared as recorded, in each transaction’s own currency, without conversion.',
								'fair-payments-connector'
							) }
						</p>
						<HStack
							justify="flex-start"
							wrap
							style={ { rowGap: '8px' } }
						>
							<Button
								variant="primary"
								type="submit"
								disabled={ ! canApply }
								style={ { flexShrink: 0, width: 'auto' } }
							>
								{ __(
									'Apply filters',
									'fair-payments-connector'
								) }
							</Button>
							<Button
								variant="tertiary"
								onClick={ handleReset }
								style={ { flexShrink: 0, width: 'auto' } }
							>
								{ __(
									'Reset filters',
									'fair-payments-connector'
								) }
							</Button>
							{ canApply && hasUnappliedChanges && (
								<span>
									{ __(
										'Filters changed. Select “Apply filters” to update the list.',
										'fair-payments-connector'
									) }
								</span>
							) }
						</HStack>
					</form>
					<HStack
						spacing={ 2 }
						justify="flex-start"
						wrap
						style={ { rowGap: '8px' } }
					>
						{ selectedTransactions.size > 0 && (
							<Button
								variant="secondary"
								onClick={ handleExport }
								disabled={ loading }
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
							onClick={ () => feeLoad.load( criteria.mode ) }
							isBusy={ loadingFees }
							disabled={ loadingFees }
							style={ {
								whiteSpace: 'nowrap',
								flexShrink: 0,
								width: 'auto',
							} }
						>
							{ loadingFees
								? __(
										'Loading fees…',
										'fair-payments-connector'
								  )
								: __(
										'Load missing Mollie fees',
										'fair-payments-connector'
								  ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => setIsImportModalOpen( true ) }
							style={ { flexShrink: 0, width: 'auto' } }
						>
							{ __( 'Import', 'fair-payments-connector' ) }
						</Button>
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

					<MollieFeeFeedback
						progress={ feeLoad.progress }
						result={ feeLoad.result }
						clearResult={ feeLoad.clearResult }
					/>

					{ loadError && (
						<Notice
							status="error"
							isDismissible={ false }
							actions={ [
								{
									label: __(
										'Try again',
										'fair-payments-connector'
									),
									onClick: loadTransactions,
								},
							] }
						>
							{ loadError }
						</Notice>
					) }

					<div style={ { margin: '8px 0 12px' } }>
						<span>
							{ __(
								'Applied filters:',
								'fair-payments-connector'
							) }
						</span>
						<ul
							style={ {
								display: 'inline-flex',
								flexWrap: 'wrap',
								gap: '4px 8px',
								margin: '0 0 0 8px',
								verticalAlign: 'top',
							} }
						>
							{ describeCriteria( criteria ).map( ( label ) => (
								<li
									key={ label }
									style={ {
										margin: 0,
										padding: '0 8px',
										background: '#f0f0f1',
										borderRadius: '2px',
										overflowWrap: 'anywhere',
									} }
								>
									{ label }
								</li>
							) ) }
						</ul>
						{ ! loading && ! loadError && (
							<p style={ { margin: '8px 0 0' } }>
								<strong>
									{ sprintf(
										// translators: %d is the number of transactions matching the applied filters.
										_n(
											'%d transaction found.',
											'%d transactions found.',
											result.total,
											'fair-payments-connector'
										),
										result.total
									) }
								</strong>
							</p>
						) }
					</div>

					{ loading && <Spinner /> }

					{ ! loading && ! loadError && transactions.length === 0 && (
						<p>
							{ isDefaultCriteria
								? __(
										'No transactions found.',
										'fair-payments-connector'
								  )
								: __(
										'No transactions match these filters. Change them or select “Reset filters”.',
										'fair-payments-connector'
								  ) }
						</p>
					) }

					{ ! loading && transactions.length > 0 && (
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
												checked={ allVisibleSelected }
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

							{ result.pages > 1 && (
								<HStack
									style={ {
										marginTop: '16px',
										justifyContent: 'center',
									} }
								>
									<Button
										variant="secondary"
										disabled={ query.page <= 1 }
										onClick={ () =>
											changeQuery( {
												page: query.page - 1,
											} )
										}
									>
										{ __(
											'Previous',
											'fair-payments-connector'
										) }
									</Button>
									<span>
										{ query.page } / { result.pages }
									</span>
									<Button
										variant="secondary"
										disabled={ query.page >= result.pages }
										onClick={ () =>
											changeQuery( {
												page: query.page + 1,
											} )
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
