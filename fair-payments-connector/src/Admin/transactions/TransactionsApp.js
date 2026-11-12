/**
 * WordPress dependencies
 */
import {
	useState,
	useEffect,
	useCallback,
	useRef,
	Fragment,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Notice,
	SelectControl,
	TextControl,
	Button,
	CheckboxControl,
} from '@wordpress/components';
import {
	AdminTable,
	AdminTableCell,
	ItemIdentity,
	StatusLabel,
	RowActions,
	TableMessage,
	ListHeader,
	ListToolbar,
	ListToolbarField,
	MoreFiltersToggle,
	MoreFiltersPanel,
	ResultCount,
	AppliedFilters,
	SelectionSummary,
	ListPagination,
	pageRange,
} from 'fair-events-shared/src/admin-table/index.js';

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

// `query` is the query object these rows answer, so rows from a previous
// query are never presented as matching a newer one.
const EMPTY_RESULT = { transactions: [], total: 0, pages: 0, query: null };

// Every criterion off: nothing is hidden, so no rows means no transactions.
const UNFILTERED_CRITERIA = { ...DEFAULT_CRITERIA, status: '', mode: '' };

// Transactions per page, as requested from the server.
const PER_PAGE = 50;

const MORE_FILTERS_ID = 'fair-payments-transactions-more-filters';

// Criteria kept under More filters; Search, Status and Mode stay visible.
const MORE_CRITERIA = [ 'dateFrom', 'dateTo', 'amountMin', 'amountMax' ];

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
	params.append( 'per_page', PER_PAGE );
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

const FIELD_ERROR_STYLE = { color: '#d63638' };

const STATUS_TONES = {
	paid: 'success',
	failed: 'error',
	canceled: 'error',
	expired: 'error',
	open: 'warning',
	pending: 'warning',
	pending_payment: 'warning',
};

/**
 * Translated sentence-case status text; an unknown stored value is shown
 * as recorded, capitalized.
 *
 * @param {string} status Stored status.
 * @return {string} Label.
 */
const statusLabel = ( status ) => {
	const known = STATUS_OPTIONS.find(
		( option ) => option.value !== '' && option.value === status
	);
	if ( known ) {
		return known.label;
	}
	return status ? status.charAt( 0 ).toUpperCase() + status.slice( 1 ) : '—';
};

/**
 * Amount with two decimals and its currency, or a dash when missing. Zero
 * stays "0.00", so a recorded zero fee is told apart from a missing one.
 *
 * @param {number|null} amount   Amount.
 * @param {string}      currency Currency code.
 * @return {string} Formatted amount.
 */
const formatMoney = ( amount, currency ) =>
	amount === null || amount === undefined || Number.isNaN( Number( amount ) )
		? '—'
		: `${ Number( amount ).toFixed( 2 ) } ${ currency }`;

const transactionUrl = ( id ) =>
	`admin.php?page=fair-payments-connector-transaction&transaction_id=${ id }`;

const SORT_OPTIONS = [
	{
		label: __( 'Date, newest first', 'fair-payments-connector' ),
		value: 'created_at:desc',
	},
	{
		label: __( 'Date, oldest first', 'fair-payments-connector' ),
		value: 'created_at:asc',
	},
	{
		label: __( 'Amount, highest first', 'fair-payments-connector' ),
		value: 'amount:desc',
	},
	{
		label: __( 'Amount, lowest first', 'fair-payments-connector' ),
		value: 'amount:asc',
	},
	{
		label: __( 'Transaction ID, highest first', 'fair-payments-connector' ),
		value: 'id:desc',
	},
	{
		label: __( 'Transaction ID, lowest first', 'fair-payments-connector' ),
		value: 'id:asc',
	},
	{
		label: __( 'Status, descending', 'fair-payments-connector' ),
		value: 'status:desc',
	},
	{
		label: __( 'Status, ascending', 'fair-payments-connector' ),
		value: 'status:asc',
	},
];

const TransactionsApp = () => {
	// Present only while Fair Finance is active; entry references stay plain
	// text otherwise so no link points at a missing screen.
	const financeEntriesUrl = window.fairPaymentTransactions?.financeEntriesUrl;
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
	const [ moreFiltersOpen, setMoreFiltersOpen ] = useState( false );
	// A ref closes the gap before re-render, so a double click can't start
	// two fee runs.
	const feesBusyRef = useRef( false );
	const queryRef = useRef( query );
	// Identifies the newest list request, so an older response arriving late
	// can't replace newer results.
	const requestRef = useRef( 0 );

	// Rows are shown only for the query that produced them. A refresh of the
	// same query (retry, fee load, import) keeps them on screen; a new
	// filter, sort or page hides them until its own response arrives.
	const isCurrent = result.query === query;
	const transactions = isCurrent ? result.transactions : [];
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
		const requested = queryRef.current;
		setLoading( true );
		setLoadError( null );

		try {
			const data = await apiFetch( {
				path: buildListPath( requested ),
			} );
			if ( requestId !== requestRef.current ) {
				return;
			}

			setResult( {
				transactions: data.transactions,
				total: data.total,
				pages: data.pages,
				query: requested,
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

			// Keep the rows and selection already shown; a failure of a new
			// query has none of its own, since they belong to the old one.
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

	// Every criterion off, including the default Paid and Live.
	const handleClear = () => {
		setDraft( UNFILTERED_CRITERIA );
		changeQuery( { criteria: UNFILTERED_CRITERIA, page: 1 } );
	};
	const isUnfiltered = sameCriteria( criteria, UNFILTERED_CRITERIA );

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

	const handleSortSelect = ( value ) => {
		const [ orderby, order ] = value.split( ':' );
		changeQuery( { orderby, order } );
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

	const columns = {
		select: __( 'Select', 'fair-payments-connector' ),
		transaction: __( 'Transaction', 'fair-payments-connector' ),
		person: __( 'Person', 'fair-payments-connector' ),
		date: __( 'Date', 'fair-payments-connector' ),
		amount: __( 'Amount', 'fair-payments-connector' ),
		status: __( 'Status', 'fair-payments-connector' ),
		entry: __( 'Entry', 'fair-payments-connector' ),
		actions: __( 'Actions', 'fair-payments-connector' ),
	};
	const selectAllLabel = __(
		'Select all transactions on this page',
		'fair-payments-connector'
	);

	/**
	 * Column header. Sortable columns hold a button, so sorting works from
	 * the keyboard, and announce their order with `aria-sort`. Called as a
	 * function, not rendered as a component, so the button keeps its DOM
	 * node (and focus) across re-renders.
	 *
	 * @param {string} label   Header text.
	 * @param {string} column  Sort key, or empty for a plain header.
	 * @param {string} variant Shared table cell variant.
	 * @return {Element} The header cell.
	 */
	const headerCell = ( label, column = '', variant = '' ) => {
		const isActive = column && query.orderby === column;
		let ariaSort;
		if ( isActive ) {
			ariaSort = query.order === 'asc' ? 'ascending' : 'descending';
		}
		const variantClass = variant
			? ` fair-admin-table__header--${ variant }`
			: '';
		return (
			<th
				key={ label }
				scope="col"
				aria-sort={ ariaSort }
				className={ `fair-admin-table__header${ variantClass }` }
			>
				{ column ? (
					<button
						type="button"
						className="fair-payments-transactions__sort"
						onClick={ () => handleSort( column ) }
					>
						{ label }
						{ isActive && (
							<span aria-hidden="true">
								{ query.order === 'asc' ? ' ▲' : ' ▼' }
							</span>
						) }
					</button>
				) : (
					label
				) }
			</th>
		);
	};

	const renderPerson = ( t ) => {
		if ( t.participant ) {
			return (
				<a href={ t.participant.admin_url }>
					{ t.participant.name ||
						t.participant.email ||
						`#${ t.participant.id }` }
				</a>
			);
		}
		return t.user_name || '—';
	};

	const renderEntries = ( t ) => {
		if ( ! t.entry_ids || t.entry_ids.length === 0 ) {
			return '—';
		}
		return (
			<span>
				{ t.entry_ids.map( ( entryId, index ) => (
					<Fragment key={ entryId }>
						{ index > 0 && ', ' }
						{ financeEntriesUrl ? (
							<a
								href={ `${ financeEntriesUrl }&entry_id=${ entryId }` }
							>
								{ `#${ entryId }` }
							</a>
						) : (
							`#${ entryId }`
						) }
					</Fragment>
				) ) }
			</span>
		);
	};

	const renderRow = ( t ) => {
		const reference = `#${ t.id }`;
		const url = transactionUrl( t.id );
		return (
			<tr key={ t.id }>
				<td
					className="fair-admin-table__cell fair-payments-transactions__select"
					data-label={ columns.select }
				>
					<input
						type="checkbox"
						aria-label={ sprintf(
							// translators: %d is the transaction ID.
							__(
								'Select transaction #%d',
								'fair-payments-connector'
							),
							t.id
						) }
						checked={ selectedTransactions.has( t.id ) }
						onChange={ () => toggleTransactionSelection( t.id ) }
					/>
				</td>
				<AdminTableCell variant="identity">
					<ItemIdentity
						title={ reference }
						href={ url }
						meta={
							t.description ||
							__( '(no description)', 'fair-payments-connector' )
						}
					/>
				</AdminTableCell>
				<AdminTableCell label={ columns.person }>
					<span className="fair-payments-transactions__person">
						{ renderPerson( t ) }
					</span>
				</AdminTableCell>
				<AdminTableCell label={ columns.date }>
					<span className="fair-payments-transactions__date">
						{ t.created_at }
					</span>
				</AdminTableCell>
				<AdminTableCell label={ columns.amount } variant="amount">
					<div className="fair-payments-transactions__amount">
						<span className="fair-payments-transactions__amount-main">
							{ formatMoney( t.amount, t.currency ) }
						</span>
						<span className="fair-payments-transactions__fee">
							{ sprintf(
								// translators: %s is the Mollie fee with its currency, e.g. "0.54 EUR", or "—" when not recorded.
								__(
									'Mollie fee: %s',
									'fair-payments-connector'
								),
								formatMoney( t.mollie_fee, t.currency )
							) }
						</span>
						<span className="fair-payments-transactions__fee">
							{ sprintf(
								// translators: %s is the integration fee with its currency, e.g. "0.90 EUR", or "—" when not recorded.
								__(
									'Integration fee: %s',
									'fair-payments-connector'
								),
								formatMoney( t.application_fee, t.currency )
							) }
						</span>
					</div>
				</AdminTableCell>
				<AdminTableCell label={ columns.status } variant="status">
					<div className="fair-payments-transactions__status">
						<StatusLabel tone={ STATUS_TONES[ t.status ] }>
							{ statusLabel( t.status ) }
						</StatusLabel>
						<span
							className={ `fair-payments-transactions__mode fair-payments-transactions__mode--${
								t.testmode ? 'test' : 'live'
							}` }
						>
							{ t.testmode
								? __( 'Test mode', 'fair-payments-connector' )
								: __( 'Live mode', 'fair-payments-connector' ) }
						</span>
					</div>
				</AdminTableCell>
				<AdminTableCell label={ columns.entry }>
					{ renderEntries( t ) }
				</AdminTableCell>
				<AdminTableCell label={ columns.actions } variant="actions">
					<RowActions
						primary={ {
							label: __(
								'View details',
								'fair-payments-connector'
							),
							accessibleLabel: sprintf(
								// translators: %d is the transaction ID.
								__(
									'View details for transaction #%d',
									'fair-payments-connector'
								),
								t.id
							),
							href: url,
						} }
					/>
				</AdminTableCell>
			</tr>
		);
	};

	const loadErrorMessage = loadError && (
		<TableMessage
			status="error"
			onRetry={ loadTransactions }
			retryLabel={ __( 'Try again', 'fair-payments-connector' ) }
		>
			{ loadError }
		</TableMessage>
	);

	let emptyMessage;
	if ( sameCriteria( criteria, UNFILTERED_CRITERIA ) ) {
		emptyMessage = (
			<TableMessage
				status="empty"
				actions={
					<Button
						variant="secondary"
						onClick={ () => setIsImportModalOpen( true ) }
					>
						{ __(
							'Import transactions',
							'fair-payments-connector'
						) }
					</Button>
				}
			>
				{ __(
					'No transactions yet. Payments appear here once someone pays or after an import.',
					'fair-payments-connector'
				) }
			</TableMessage>
		);
	} else if ( isDefaultCriteria ) {
		emptyMessage = (
			<TableMessage
				status="no-results"
				onClear={ handleClear }
				clearLabel={ __( 'Clear filters', 'fair-payments-connector' ) }
			>
				{ __(
					'No paid live transactions. Change the Status or Mode filter to see other transactions.',
					'fair-payments-connector'
				) }
			</TableMessage>
		);
	} else {
		emptyMessage = (
			<TableMessage
				status="no-results"
				onClear={ handleClear }
				clearLabel={ __( 'Clear filters', 'fair-payments-connector' ) }
			>
				{ __(
					'No transactions match these filters. Change them or select “Reset filters”.',
					'fair-payments-connector'
				) }
			</TableMessage>
		);
	}

	const loadingMessage = (
		<TableMessage status="loading">
			{ __( 'Loading transactions…', 'fair-payments-connector' ) }
		</TableMessage>
	);

	// A draft error under More filters keeps the panel open, so the reason
	// Apply is unavailable stays visible.
	const moreHasError = MORE_CRITERIA.some( ( key ) => draftErrors[ key ] );
	const isMoreOpen = moreFiltersOpen || moreHasError;
	const moreActive = MORE_CRITERIA.filter(
		( key ) => draft[ key ].trim() !== ''
	).length;
	const moreFiltersLabel = moreActive
		? sprintf(
				// translators: %d is the number of filled-in filters under More filters.
				_n(
					'More filters (%d active)',
					'More filters (%d active)',
					moreActive,
					'fair-payments-connector'
				),
				moreActive
			)
		: __( 'More filters', 'fair-payments-connector' );

	const { first, last } = pageRange( query.page, PER_PAGE, result.total );
	let resultCountText = null;
	if ( isCurrent && result.total > 0 ) {
		resultCountText =
			result.pages > 1
				? sprintf(
						// translators: 1: first shown position, 2: last shown position, 3: number of transactions matching the applied filters.
						_n(
							'%1$d–%2$d of %3$d transaction',
							'%1$d–%2$d of %3$d transactions',
							result.total,
							'fair-payments-connector'
						),
						first,
						last,
						result.total
					)
				: sprintf(
						// translators: %d is the number of transactions matching the applied filters.
						_n(
							'%d transaction',
							'%d transactions',
							result.total,
							'fair-payments-connector'
						),
						result.total
					);
	}

	const selectedOnPage = transactions.filter( ( t ) =>
		selectedTransactions.has( t.id )
	).length;

	let listBody;
	if ( transactions.length > 0 ) {
		listBody = (
			<>
				{ loadErrorMessage }
				{ loading && loadingMessage }
				<div className="fair-payments-transactions__narrow-controls">
					<SelectControl
						label={ __( 'Sort by', 'fair-payments-connector' ) }
						value={ `${ query.orderby }:${ query.order }` }
						options={ SORT_OPTIONS }
						onChange={ handleSortSelect }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					<CheckboxControl
						label={ selectAllLabel }
						checked={ allVisibleSelected }
						onChange={ toggleAllTransactions }
						__nextHasNoMarginBottom
					/>
				</div>
				<AdminTable
					caption={ __(
						'Payment transactions',
						'fair-payments-connector'
					) }
					className="fair-payments-transactions__table"
				>
					<thead>
						<tr>
							<th
								scope="col"
								className="fair-admin-table__header fair-payments-transactions__select"
							>
								<input
									type="checkbox"
									aria-label={ selectAllLabel }
									checked={ allVisibleSelected }
									onChange={ toggleAllTransactions }
								/>
							</th>
							{ headerCell(
								columns.transaction,
								'id',
								'identity'
							) }
							{ headerCell( columns.person ) }
							{ headerCell( columns.date, 'created_at' ) }
							{ headerCell( columns.amount, 'amount', 'amount' ) }
							{ headerCell( columns.status, 'status', 'status' ) }
							{ headerCell( columns.entry ) }
							{ headerCell( columns.actions, '', 'actions' ) }
						</tr>
					</thead>
					<tbody aria-busy={ loading || undefined }>
						{ transactions.map( renderRow ) }
					</tbody>
				</AdminTable>
			</>
		);
	} else if ( loading ) {
		listBody = loadingMessage;
	} else if ( loadError ) {
		listBody = loadErrorMessage;
	} else {
		listBody = emptyMessage;
	}

	return (
		<div className="wrap fair-payments-transactions">
			<ListHeader
				title={ __(
					'Payment Transactions',
					'fair-payments-connector'
				) }
				actions={
					<>
						<Button
							variant="secondary"
							onClick={ () => setIsImportModalOpen( true ) }
						>
							{ __( 'Import', 'fair-payments-connector' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => feeLoad.load( criteria.mode ) }
							isBusy={ loadingFees }
							disabled={ loadingFees }
							accessibleWhenDisabled
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
					</>
				}
			/>

			<form
				onSubmit={ handleApply }
				noValidate
				aria-label={ __(
					'Filter transactions',
					'fair-payments-connector'
				) }
			>
				<ListToolbar
					selection={
						selectedOnPage > 0 && (
							<SelectionSummary
								label={ sprintf(
									// translators: %d is the number of selected transactions.
									_n(
										'%d transaction selected',
										'%d transactions selected',
										selectedOnPage,
										'fair-payments-connector'
									),
									selectedOnPage
								) }
							>
								<Button
									variant="secondary"
									size="compact"
									onClick={ handleExport }
									disabled={ loading }
									accessibleWhenDisabled
								>
									{ __(
										'Export Selected',
										'fair-payments-connector'
									) }
								</Button>
							</SelectionSummary>
						)
					}
					actions={
						<>
							<MoreFiltersToggle
								panelId={ MORE_FILTERS_ID }
								isOpen={ isMoreOpen }
								onToggle={ () =>
									setMoreFiltersOpen( ! isMoreOpen )
								}
								label={ moreFiltersLabel }
							/>
							<Button
								variant="primary"
								type="submit"
								disabled={ ! canApply }
								accessibleWhenDisabled
							>
								{ __(
									'Apply filters',
									'fair-payments-connector'
								) }
							</Button>
							<Button variant="tertiary" onClick={ handleReset }>
								{ __(
									'Reset filters',
									'fair-payments-connector'
								) }
							</Button>
							{ ! isUnfiltered && (
								<Button
									variant="tertiary"
									onClick={ handleClear }
								>
									{ __(
										'Clear filters',
										'fair-payments-connector'
									) }
								</Button>
							) }
						</>
					}
					count={
						resultCountText && (
							<ResultCount>{ resultCountText }</ResultCount>
						)
					}
					panel={
						<MoreFiltersPanel
							id={ MORE_FILTERS_ID }
							isOpen={ isMoreOpen }
							label={ __(
								'More filters',
								'fair-payments-connector'
							) }
						>
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
							<p className="description fair-admin-list-toolbar__panel-note">
								{ __(
									'Dates include the whole day in the site timezone. Amounts are compared as recorded, in each transaction’s own currency, without conversion.',
									'fair-payments-connector'
								) }
							</p>
						</MoreFiltersPanel>
					}
				>
					<ListToolbarField wide>
						<TextControl
							type="search"
							label={ __( 'Search', 'fair-payments-connector' ) }
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
					</ListToolbarField>
					<ListToolbarField>
						<SelectControl
							label={ __( 'Status', 'fair-payments-connector' ) }
							value={ draft.status }
							options={ STATUS_OPTIONS }
							onChange={ setDraftField( 'status' ) }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>
					</ListToolbarField>
					<ListToolbarField>
						<SelectControl
							label={ __( 'Mode', 'fair-payments-connector' ) }
							value={ draft.mode }
							options={ MODE_OPTIONS }
							onChange={ setDraftField( 'mode' ) }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>
					</ListToolbarField>
				</ListToolbar>
				{ canApply && hasUnappliedChanges && (
					<p className="fair-payments-transactions__unapplied">
						{ __(
							'Filters changed. Select “Apply filters” to update the list.',
							'fair-payments-connector'
						) }
					</p>
				) }
			</form>

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

			{ /* The criteria that produced the shown rows, not the draft. */ }
			<AppliedFilters
				label={ __( 'Applied filters:', 'fair-payments-connector' ) }
				items={ describeCriteria( criteria ) }
			/>

			{ listBody }

			{ /*
			 * Stays mounted while another page loads, so the button that
			 * was used keeps focus; hidden when that load fails.
			 */ }
			{ result.pages > 1 && ( isCurrent || ! loadError ) && (
				<ListPagination
					page={ query.page }
					totalPages={ result.pages }
					label={ __(
						'Transaction pages',
						'fair-payments-connector'
					) }
					positionLabel={ sprintf(
						// translators: 1: current page number, 2: number of pages.
						__( 'Page %1$d of %2$d', 'fair-payments-connector' ),
						query.page,
						result.pages
					) }
					previousLabel={ __(
						'Previous page',
						'fair-payments-connector'
					) }
					nextLabel={ __( 'Next page', 'fair-payments-connector' ) }
					onChange={ ( page ) => changeQuery( { page } ) }
				/>
			) }

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
