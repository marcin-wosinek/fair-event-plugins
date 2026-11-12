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
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import EntryForm from './components/EntryForm.js';
import MatchModal from './components/MatchModal.js';
import UnmatchModal from './components/UnmatchModal.js';
import ImportModal from './components/ImportModal.js';
import SplitModal from './components/SplitModal.js';
import TransferModal from './components/TransferModal.js';
import TagChart from './components/TagChart.js';
import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';
import { buildEntriesCsv, downloadCsv } from './exportEntriesCsv.js';
import {
	AdminTable,
	AdminTableCell,
	ItemIdentity,
	RowActions,
	StatusLabel,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';

const eventsEnabled = window.fairPaymentSettings?.eventsEnabled === '1';

const getEventUrlLabel = ( url ) => {
	try {
		const parsed = new URL( url );
		const path = parsed.pathname.replace( /\/$/, '' );
		const segment = path.split( '/' ).pop();
		return segment ? segment.replace( /-/g, ' ' ) : parsed.hostname;
	} catch {
		return url;
	}
};

const EVENT_DATE_PREFIX = 'id:';
const EVENT_URL_PREFIX = 'url:';

/**
 * Build the Link filter options: local event dates first, then URL-only
 * links. A URL that exactly matches a local event date's display URL is
 * merged into that event date's option, so administrators see one option
 * per event regardless of how each entry stores its link.
 *
 * @param {Array<{label: string, id: string, url: string|null}>} eventDates Local event dates.
 * @param {string[]}                                             eventUrls  Distinct entry URLs.
 * @return {Array<{label: string, value: string}>} Select options.
 */
const buildEventFilterOptions = ( eventDates, eventUrls ) => {
	const localUrls = new Set(
		eventDates.map( ( eventDate ) => eventDate.url ).filter( Boolean )
	);
	return [
		...eventDates.map( ( eventDate ) => ( {
			label: eventDate.label,
			value: EVENT_DATE_PREFIX + eventDate.id,
		} ) ),
		...eventUrls
			.filter( ( url ) => ! localUrls.has( url ) )
			.map( ( url ) => ( {
				label: getEventUrlLabel( url ),
				value: EVENT_URL_PREFIX + url,
			} ) ),
	];
};

/**
 * The Link filter value for the current filters.
 *
 * @param {Object} filters Active filters.
 * @return {string} Select value, empty when no link is selected.
 */
const getEventFilterValue = ( filters ) => {
	if ( filters.event_date_id ) {
		return EVENT_DATE_PREFIX + filters.event_date_id;
	}
	if ( filters.event_url ) {
		return EVENT_URL_PREFIX + filters.event_url;
	}
	return '';
};

const DEFAULT_FILTERS = {
	date_from: '',
	date_to: '',
	budget_id: '',
	event_url: '',
	event_date_id: '',
	tag: '',
	entry_type: '',
	unmatched: false,
};

/**
 * Read the focused entry from the `entry_id` URL parameter.
 *
 * @return {{id: number|null, invalid: boolean}} The focused entry ID, or
 *     `invalid` when the parameter is present but not a positive integer.
 */
const readFocusFromUrl = () => {
	const raw = new URLSearchParams( window.location.search ).get( 'entry_id' );
	if ( raw === null ) {
		return { id: null, invalid: false };
	}
	if ( ! /^[1-9]\d*$/.test( raw ) ) {
		return { id: null, invalid: true };
	}
	return { id: parseInt( raw, 10 ), invalid: false };
};

/**
 * The number of entries awaiting a budget, with distinct loading and error
 * states so neither can be mistaken for zero.
 *
 * @param {Object}   props         Props.
 * @param {Object}   props.state   `{ status: 'loading'|'success'|'error', count }`.
 * @param {Function} props.onRetry Reloads the count after a failure.
 */
const UnbudgetedCount = ( { state, onRetry } ) => {
	let content;
	if ( state.status === 'error' ) {
		content = (
			<>
				<span>
					{ __(
						'The number of entries without a budget could not be loaded.',
						'fair-finance'
					) }
				</span>
				<Button variant="link" onClick={ onRetry }>
					{ __( 'Retry', 'fair-finance' ) }
				</Button>
			</>
		);
	} else if ( state.status === 'success' ) {
		content = (
			<strong>
				{ sprintf(
					/* translators: %d: number of financial entries without a budget */
					_n(
						'%d entry is waiting for a budget.',
						'%d entries are waiting for a budget.',
						state.count,
						'fair-finance'
					),
					state.count
				) }
			</strong>
		);
	} else {
		content = (
			<>
				<Spinner />
				<span>
					{ __(
						'Counting entries without a budget…',
						'fair-finance'
					) }
				</span>
			</>
		);
	}

	return (
		<div
			className={ `fair-finance-unbudgeted-count is-${ state.status }` }
			role="status"
		>
			{ content }
		</div>
	);
};

/**
 * Source line under a classified entry's description: how it was paid and,
 * for a personal expense, by whom. Personally paid amounts are a record of
 * who paid, not a balance owed.
 *
 * @param {Object} props
 * @param {Object} props.entry Financial entry with a payment source.
 */
const PaymentSourceNote = ( { entry } ) => (
	<span className="fair-admin-table__identity-meta">
		{ 'personal_funds' === entry.payment_source
			? sprintf(
					/* translators: %s: name of the person who paid */
					__( 'Personal funds, paid by %s', 'fair-finance' ),
					entry.payer_name || __( '(unnamed)', 'fair-finance' )
				)
			: __( 'Event cash', 'fair-finance' ) }
	</span>
);
const EntriesApp = () => {
	// Focus is read before the first data request so a focused link never
	// loads the full list first.
	const [ focus, setFocus ] = useState( readFocusFromUrl );
	const isFocused = focus.id !== null || focus.invalid;
	const entriesRequestRef = useRef( 0 );
	const totalsRequestRef = useRef( 0 );
	const unbudgetedRequestRef = useRef( 0 );
	const [ entries, setEntries ] = useState( [] );
	const [ budgets, setBudgets ] = useState( [] );
	const [ eventUrls, setEventUrls ] = useState( [] );
	const [ eventDates, setEventDates ] = useState( [] );
	const [ tags, setTags ] = useState( [] );
	const [ tagTotals, setTagTotals ] = useState( {} );
	// Entries awaiting a budget, across the whole ledger. Independent of the
	// table's filters, pagination, sorting and focus.
	const [ unbudgeted, setUnbudgeted ] = useState( {
		status: 'loading',
		count: null,
	} );
	const [ totals, setTotals ] = useState( {
		total_cost: 0,
		total_income: 0,
		balance: 0,
	} );
	const [ pagination, setPagination ] = useState( {
		total: 0,
		pages: 0,
		page: 1,
	} );
	const [ filters, setFilters ] = useState( DEFAULT_FILTERS );
	const [ sort, setSort ] = useState( {
		orderby: 'entry_date',
		order: 'desc',
	} );
	const [ loading, setLoading ] = useState( true );
	// Rows stay mounted after the first successful load, so dialogs can
	// return focus to the row that opened them.
	const [ hasLoaded, setHasLoaded ] = useState( false );
	const [ loadError, setLoadError ] = useState( null );
	const [ focusHeading, setFocusHeading ] = useState( false );
	const headingRef = useRef( null );
	const [ exportLoading, setExportLoading ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );

	// Modal states
	const [ isFormOpen, setIsFormOpen ] = useState( false );
	const [ editingEntry, setEditingEntry ] = useState( null );
	const [ matchingEntry, setMatchingEntry ] = useState( null );
	const [ unmatchingEntry, setUnmatchingEntry ] = useState( null );
	const [ isImportOpen, setIsImportOpen ] = useState( false );
	const [ splittingEntry, setSplittingEntry ] = useState( null );
	const deleteEntry = useConfirmAction();
	const unsplitEntry = useConfirmAction();
	const [ isTransferOpen, setIsTransferOpen ] = useState( false );
	const [ transferEntry, setTransferEntry ] = useState( null );
	const [ expandedEntries, setExpandedEntries ] = useState( {} );

	// After a deletion the row and its menu trigger are gone. Focus the
	// heading once the confirmation has unmounted and returned focus.
	useEffect( () => {
		if ( focusHeading && ! deleteEntry.target ) {
			headingRef.current?.focus();
			setFocusHeading( false );
		}
	}, [ focusHeading, deleteEntry.target ] );

	useEffect( () => {
		loadBudgets();

		const params = new URLSearchParams( window.location.search );
		const budgetId = params.get( 'budget_id' );
		if ( budgetId ) {
			setFilters( ( prev ) => ( { ...prev, budget_id: budgetId } ) );
		}
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();

			const params = new URLSearchParams( window.location.search );
			const eventDateId = params.get( 'event_date_id' );
			if ( eventDateId ) {
				setFilters( ( prev ) => ( {
					...prev,
					event_date_id: eventDateId,
				} ) );
			}
		}
		loadTags();
		loadUnbudgetedCount();
	}, [] );

	useEffect( () => {
		if ( focus.invalid ) {
			setLoading( false );
			return;
		}
		loadEntries();
		loadTotals();
		// The tag chart shows global totals, so it is hidden while focused.
		if ( focus.id === null ) {
			loadTagTotals();
		}
	}, [ filters, pagination.page, sort, focus ] );

	/**
	 * Append the active filters to request params. A focused entry takes
	 * precedence over every ordinary filter.
	 *
	 * @param {URLSearchParams} params                    Params to extend.
	 * @param {Object}          options                   Options.
	 * @param {boolean}         options.includeEntryType  Whether to send the type filter.
	 */
	const appendFilterParams = ( params, { includeEntryType } ) => {
		if ( focus.id !== null ) {
			params.append( 'entry_id', focus.id );
			return;
		}
		if ( filters.date_from )
			params.append( 'date_from', filters.date_from );
		if ( filters.date_to ) params.append( 'date_to', filters.date_to );
		if ( filters.budget_id )
			params.append( 'budget_id', filters.budget_id );
		if ( filters.event_url )
			params.append( 'event_url', filters.event_url );
		if ( filters.event_date_id )
			params.append( 'event_date_id', filters.event_date_id );
		if ( filters.tag ) params.append( 'tag', filters.tag );
		if ( includeEntryType && filters.entry_type )
			params.append( 'entry_type', filters.entry_type );
		if ( filters.unmatched ) params.append( 'unmatched', 'true' );
	};

	const clearFocus = () => {
		const url = new URL( window.location.href );
		url.searchParams.delete( 'entry_id' );
		window.history.replaceState( null, '', url.toString() );

		setError( null );
		setLoadError( null );
		setFilters( DEFAULT_FILTERS );
		setPagination( ( prev ) => ( { ...prev, page: 1 } ) );
		setFocus( { id: null, invalid: false } );
	};

	const loadBudgets = async () => {
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/budgets',
			} );
			setBudgets( data );
		} catch ( err ) {
			console.error( 'Failed to load budgets:', err );
		}
	};

	const loadEventUrls = async () => {
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/event-urls',
			} );
			setEventUrls( data );
		} catch ( err ) {
			console.error( 'Failed to load event URLs:', err );
		}
	};

	const loadEventDateOptions = async () => {
		try {
			const ids = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/event-date-ids',
			} );
			if ( ids.length === 0 ) {
				setEventDates( [] );
				return;
			}
			try {
				const events = await apiFetch( {
					path: `/fair-events/v1/event-dates/batch?ids=${ ids.join(
						','
					) }`,
				} );
				setEventDates(
					events.map( ( event ) => ( {
						label:
							event.title ||
							getEventUrlLabel( event.display_url || '' ),
						id: event.id.toString(),
						url: event.display_url || null,
					} ) )
				);
			} catch {
				// fair-events not available, fall back to bare IDs.
				setEventDates(
					ids.map( ( id ) => ( {
						label: `#${ id }`,
						id: id.toString(),
						url: null,
					} ) )
				);
			}
		} catch ( err ) {
			console.error( 'Failed to load event date IDs:', err );
		}
	};

	const loadTags = async () => {
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/tags',
			} );
			setTags( Array.isArray( data ) ? data : [] );
		} catch ( err ) {
			console.error( 'Failed to load tags:', err );
		}
	};

	const loadTagTotals = async () => {
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/totals-by-tag',
			} );
			setTagTotals( data || {} );
		} catch ( err ) {
			console.error( 'Failed to load tag totals:', err );
		}
	};

	/**
	 * Load the current page of entries.
	 *
	 * @param {Object}  options       Options.
	 * @param {boolean} options.quiet Keep the table mounted while reloading,
	 *                                so focus can return to a row's control,
	 *                                and keep the rows if the reload fails.
	 */
	const loadEntries = async ( { quiet = false } = {} ) => {
		// Only the latest request may update the list, so a slow response
		// for a previous view (e.g. before focus was cleared) is dropped.
		const requestId = ++entriesRequestRef.current;
		if ( ! quiet ) {
			setLoading( true );
		}
		setLoadError( null );

		try {
			const params = new URLSearchParams();
			params.append( 'page', pagination.page );
			params.append( 'per_page', 50 );
			appendFilterParams( params, { includeEntryType: true } );
			params.append( 'orderby', sort.orderby );
			params.append( 'order', sort.order );

			const data = await apiFetch( {
				path: `/fair-finance/v1/financial-entries?${ params.toString() }`,
			} );
			if ( requestId !== entriesRequestRef.current ) {
				return;
			}

			setEntries( data.entries );
			setHasLoaded( true );
			setPagination( ( prev ) => ( {
				...prev,
				total: data.total,
				pages: data.pages,
			} ) );
		} catch ( err ) {
			if ( requestId !== entriesRequestRef.current ) {
				return;
			}
			// A quiet refresh keeps the rows already shown, so the
			// organizer keeps their place; retry from the message.
			if ( quiet ) {
				setLoadError(
					__(
						'The list could not be refreshed. Try again to see the current entries.',
						'fair-finance'
					)
				);
				return;
			}
			setEntries( [] );
			setLoadError(
				err.message || __( 'Failed to load entries.', 'fair-finance' )
			);
		} finally {
			if ( requestId === entriesRequestRef.current ) {
				setLoading( false );
			}
		}
	};

	const loadTotals = async () => {
		const requestId = ++totalsRequestRef.current;
		try {
			const params = new URLSearchParams();
			appendFilterParams( params, { includeEntryType: false } );

			const data = await apiFetch( {
				path: `/fair-finance/v1/financial-entries/totals?${ params.toString() }`,
			} );
			if ( requestId !== totalsRequestRef.current ) {
				return;
			}

			setTotals( data );
		} catch ( err ) {
			console.error( 'Failed to load totals:', err );
		}
	};

	const loadUnbudgetedCount = async () => {
		// Only the latest request may update the count, so a slow response
		// from before a save never overwrites the refreshed value.
		const requestId = ++unbudgetedRequestRef.current;
		setUnbudgeted( { status: 'loading', count: null } );
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/financial-entries/unbudgeted-count',
			} );
			if ( requestId !== unbudgetedRequestRef.current ) {
				return;
			}
			const count = Number( data?.count );
			if ( ! Number.isInteger( count ) || count < 0 ) {
				throw new Error( 'Invalid unbudgeted count response.' );
			}
			setUnbudgeted( { status: 'success', count } );
		} catch {
			if ( requestId !== unbudgetedRequestRef.current ) {
				return;
			}
			setUnbudgeted( { status: 'error', count: null } );
		}
	};

	const exportCsv = async () => {
		setExportLoading( true );
		try {
			const params = new URLSearchParams();
			appendFilterParams( params, { includeEntryType: true } );
			params.append( 'orderby', sort.orderby );
			params.append( 'order', sort.order );
			params.append( 'per_page', 100 );

			let allEntries = [];
			let page = 1;
			let totalPages = 1;
			do {
				params.set( 'page', page );
				const data = await apiFetch( {
					path: `/fair-finance/v1/financial-entries?${ params.toString() }`,
				} );
				allEntries = allEntries.concat( data.entries );
				totalPages = data.pages;
				page++;
			} while ( page <= totalPages );

			let scope = 'all';
			if ( focus.id !== null ) {
				scope = `entry-${ focus.id }`;
			} else if ( filters.budget_id ) {
				scope = `budget-${ filters.budget_id }`;
			}
			const filename = `fair-finance-entries-${ scope }.csv`;
			downloadCsv( buildEntriesCsv( allEntries, budgets ), filename );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to export entries.', 'fair-finance' )
			);
		} finally {
			setExportLoading( false );
		}
	};

	const handleCreate = () => {
		setEditingEntry( null );
		setIsFormOpen( true );
	};

	const handleEdit = ( entry ) => {
		setEditingEntry( entry );
		setIsFormOpen( true );
	};

	// Mutations refresh in place: the rows stay mounted, so a dialog can
	// return focus to the control that opened it.
	const reloadAfterRemoval = () => {
		loadEntries( { quiet: true } );
		loadTotals();
		loadUnbudgetedCount();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleDelete = () =>
		deleteEntry.run(
			async ( entry ) => {
				await apiFetch( {
					path: `/fair-finance/v1/financial-entries/${ entry.id }`,
					method: 'DELETE',
				} );
				setError( null );
				setSuccess(
					sprintf(
						/* translators: %s: financial entry description */
						__( 'Entry “%s” deleted.', 'fair-finance' ),
						entryLabel( entry )
					)
				);
				// The row and its menu are gone; move focus to the heading.
				setFocusHeading( true );
				reloadAfterRemoval();
			},
			__( 'The entry could not be deleted. Try again.', 'fair-finance' )
		);

	const handleFormSave = () => {
		setIsFormOpen( false );
		setEditingEntry( null );
		setSuccess(
			editingEntry
				? __( 'Entry updated successfully.', 'fair-finance' )
				: __( 'Entry created successfully.', 'fair-finance' )
		);
		loadEntries( { quiet: true } );
		loadTotals();
		loadTags();
		loadUnbudgetedCount();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleFormCancel = () => {
		setIsFormOpen( false );
		setEditingEntry( null );
	};

	const handleMatch = ( entry ) => {
		setMatchingEntry( entry );
	};

	const handleUnmatch = ( entry ) => {
		setSuccess( null );
		setUnmatchingEntry( entry );
	};

	const handleUnmatchComplete = () => {
		setUnmatchingEntry( null );
		setSuccess( __( 'Entry unmatched successfully.', 'fair-finance' ) );
		loadEntries( { quiet: true } );
		loadUnbudgetedCount();
	};

	const handleUnmatchCancel = () => {
		setUnmatchingEntry( null );
	};

	const handleMatchComplete = () => {
		setMatchingEntry( null );
		setSuccess( __( 'Entry matched to transaction.', 'fair-finance' ) );
		loadEntries( { quiet: true } );
		loadUnbudgetedCount();
	};

	const handleMatchCancel = () => {
		setMatchingEntry( null );
	};

	const handleImport = () => {
		setIsImportOpen( true );
	};

	const handleImportComplete = () => {
		setIsImportOpen( false );
		setSuccess( __( 'Entries imported successfully.', 'fair-finance' ) );
		loadEntries( { quiet: true } );
		loadTotals();
		loadUnbudgetedCount();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleImportCancel = () => {
		setIsImportOpen( false );
	};

	const handleSplit = ( entry ) => {
		setSplittingEntry( entry );
	};

	const handleSplitComplete = () => {
		const wasEdit =
			splittingEntry?.children && splittingEntry.children.length > 0;
		setSplittingEntry( null );
		setSuccess(
			wasEdit
				? __( 'Split updated successfully.', 'fair-finance' )
				: __( 'Entry split successfully.', 'fair-finance' )
		);
		loadEntries( { quiet: true } );
		loadTotals();
		loadUnbudgetedCount();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleSplitCancel = () => {
		setSplittingEntry( null );
	};

	const handleUnsplit = () =>
		unsplitEntry.run(
			async ( entry ) => {
				await apiFetch( {
					path: `/fair-finance/v1/financial-entries/${ entry.id }/split`,
					method: 'DELETE',
				} );
				setSplittingEntry( null );
				setError( null );
				setSuccess(
					sprintf(
						/* translators: %s: financial entry description */
						__( 'Entry “%s” unsplit.', 'fair-finance' ),
						entryLabel( entry )
					)
				);
				reloadAfterRemoval();
			},
			__( 'The entry could not be unsplit. Try again.', 'fair-finance' )
		);

	const handleTransfer = () => {
		setTransferEntry( null );
		setIsTransferOpen( true );
	};

	const handleEditTransfer = ( entry ) => {
		setTransferEntry( entry );
		setIsTransferOpen( true );
	};

	const handleTransferSave = () => {
		setIsTransferOpen( false );
		setTransferEntry( null );
		setSuccess(
			transferEntry
				? __( 'Transfer updated successfully.', 'fair-finance' )
				: __( 'Transfer created successfully.', 'fair-finance' )
		);
		loadEntries( { quiet: true } );
		loadTotals();
		loadUnbudgetedCount();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleTransferCancel = () => {
		setIsTransferOpen( false );
		setTransferEntry( null );
	};

	const toggleExpanded = ( entryId ) => {
		setExpandedEntries( ( prev ) => ( {
			...prev,
			[ entryId ]: ! prev[ entryId ],
		} ) );
	};

	const handleFilterChange = ( key, value ) => {
		setFilters( ( prev ) => ( { ...prev, [ key ]: value } ) );
		setPagination( ( prev ) => ( { ...prev, page: 1 } ) );
	};

	/**
	 * Select a link: a local event date or a URL-only link. The other link
	 * field is cleared so list, totals and export all use one selection.
	 *
	 * @param {string} value Prefixed option value, or empty to clear.
	 */
	const handleEventFilterChange = ( value ) => {
		const eventDateId = value.startsWith( EVENT_DATE_PREFIX )
			? value.slice( EVENT_DATE_PREFIX.length )
			: '';
		const eventUrl = value.startsWith( EVENT_URL_PREFIX )
			? value.slice( EVENT_URL_PREFIX.length )
			: '';
		setFilters( ( prev ) => ( {
			...prev,
			event_date_id: eventDateId,
			event_url: eventUrl,
		} ) );
		setPagination( ( prev ) => ( { ...prev, page: 1 } ) );
	};

	const handlePageChange = ( newPage ) => {
		setPagination( ( prev ) => ( { ...prev, page: newPage } ) );
	};

	const handleSort = ( column ) => {
		setSort( ( prev ) => ( {
			orderby: column,
			order:
				prev.orderby === column && prev.order === 'desc'
					? 'asc'
					: 'desc',
		} ) );
		setPagination( ( prev ) => ( { ...prev, page: 1 } ) );
	};

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
		const isActive = column && sort.orderby === column;
		let ariaSort;
		if ( isActive ) {
			ariaSort = sort.order === 'asc' ? 'ascending' : 'descending';
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
						className="fair-finance-entries__sort"
						onClick={ () => handleSort( column ) }
					>
						{ label }
						{ isActive && (
							<span aria-hidden="true">
								{ sort.order === 'asc' ? ' \u25B2' : ' \u25BC' }
							</span>
						) }
					</button>
				) : (
					label
				) }
			</th>
		);
	};

	const formatAmount = ( amount ) => {
		return new Intl.NumberFormat( 'en-US', {
			style: 'currency',
			currency: 'EUR',
		} ).format( amount );
	};

	const getBudgetName = ( budgetId ) => {
		const budget = budgets.find( ( b ) => b.id === budgetId );
		return budget ? budget.name : '—';
	};

	const entryLabel = ( entry ) =>
		entry.description ||
		/* translators: %d: financial entry ID */
		sprintf( __( 'Entry #%d', 'fair-finance' ), entry.id );

	// Date and amount, so entries sharing a description stay distinguishable.
	const entrySummary = ( entry ) =>
		sprintf(
			/* translators: 1: entry date, 2: entry amount */
			__( 'Dated %1$s, %2$s.', 'fair-finance' ),
			entry.entry_date,
			formatAmount( entry.amount )
		);

	const budgetOptions = [
		{ label: __( 'All Budgets', 'fair-finance' ), value: '' },
		...budgets.map( ( budget ) => ( {
			label: budget.name,
			value: budget.id.toString(),
		} ) ),
		{ label: __( 'Unbudgeted', 'fair-finance' ), value: 'none' },
	];

	const eventFilterOptions = buildEventFilterOptions( eventDates, eventUrls );

	const hasActiveFilters = Object.keys( DEFAULT_FILTERS ).some(
		( key ) => filters[ key ] !== DEFAULT_FILTERS[ key ]
	);

	const clearFilters = () => {
		setFilters( DEFAULT_FILTERS );
		setPagination( ( prev ) => ( { ...prev, page: 1 } ) );
	};

	const retryLoad = () => {
		loadEntries( { quiet: hasLoaded && entries.length > 0 } );
		loadTotals();
	};

	const columns = {
		description: __( 'Description', 'fair-finance' ),
		date: __( 'Date', 'fair-finance' ),
		type: __( 'Type', 'fair-finance' ),
		amount: __( 'Amount', 'fair-finance' ),
		budget: __( 'Budget', 'fair-finance' ),
		link: __( 'Link', 'fair-finance' ),
		matched: __( 'Matched', 'fair-finance' ),
		imported: __( 'Imported', 'fair-finance' ),
		actions: __( 'Actions', 'fair-finance' ),
	};

	const noValue = '—';

	const typeLabel = ( type ) => {
		if ( 'transfer' === type ) {
			return __( 'Transfer', 'fair-finance' );
		}
		return 'cost' === type
			? __( 'Cost', 'fair-finance' )
			: __( 'Income', 'fair-finance' );
	};

	const renderType = ( type ) => (
		<span
			className={ `fair-finance-entries__type fair-finance-entries__type--${ type }` }
		>
			{ typeLabel( type ) }
		</span>
	);

	const renderLink = ( url ) =>
		url ? (
			<a
				href={ url }
				target="_blank"
				rel="noopener noreferrer"
				title={ url }
			>
				{ getEventUrlLabel( url ) }
			</a>
		) : (
			noValue
		);

	// Keeps desktop columns aligned without an empty labeled block on
	// narrow screens, where it is hidden.
	const emptyCell = ( key ) => (
		<td
			key={ key }
			className="fair-admin-table__cell fair-finance-entries__empty-cell"
		/>
	);

	const renderBudget = ( entry, isTransfer, isSplit ) => {
		if ( isTransfer ) {
			const costChild = entry.children?.find(
				( c ) => c.entry_type === 'cost'
			);
			const incomeChild = entry.children?.find(
				( c ) => c.entry_type === 'income'
			);
			return sprintf(
				/* translators: 1: source budget name, 2: target budget name */
				__( '%1$s → %2$s', 'fair-finance' ),
				getBudgetName( costChild?.budget_id ),
				getBudgetName( incomeChild?.budget_id )
			);
		}
		if ( isSplit ) {
			return sprintf(
				/* translators: %d: number of split allocations */
				_n(
					'Split into %d allocation',
					'Split into %d allocations',
					entry.children.length,
					'fair-finance'
				),
				entry.children.length
			);
		}
		return getBudgetName( entry.budget_id );
	};

	const renderMatched = ( entry ) => {
		const count = entry.transaction_ids?.length || 0;
		if ( count === 0 ) {
			return (
				<StatusLabel tone="warning">
					{ __( 'No', 'fair-finance' ) }
				</StatusLabel>
			);
		}
		return (
			<StatusLabel tone="success">
				{ count > 1
					? sprintf(
							/* translators: %d: number of matched transactions */
							__( 'Yes (%d)', 'fair-finance' ),
							count
						)
					: __( 'Yes', 'fair-finance' ) }
			</StatusLabel>
		);
	};

	/**
	 * The row's visible action and its overflow menu. Eligibility follows
	 * the entry kind: transfers open the transfer editor, split entries and
	 * their allocations open the split editor, and entries recorded as event
	 * cash or personally paid are neither split nor matched.
	 *
	 * @param {Object} entry Financial entry.
	 * @return {Object} RowActions props.
	 */
	const getRowActions = ( entry ) => {
		const name = entryLabel( entry );
		const isTransfer = entry.entry_type === 'transfer';
		const isSplit = ! isTransfer && entry.children?.length > 0;
		const isClassified = !! entry.payment_source;
		const isMatched = entry.transaction_ids?.length > 0;
		const moreLabel = sprintf(
			/* translators: %s: financial entry description */
			__( 'More actions for “%s”', 'fair-finance' ),
			name
		);
		const editAction = ( onClick ) => ( {
			label: __( 'Edit', 'fair-finance' ),
			accessibleLabel: sprintf(
				/* translators: %s: financial entry description */
				__( 'Edit “%s”', 'fair-finance' ),
				name
			),
			onClick,
		} );
		const editSplitAction = ( target ) => ( {
			label: __( 'Edit split', 'fair-finance' ),
			accessibleLabel: sprintf(
				/* translators: %s: description of the split financial entry */
				__( 'Edit split “%s”', 'fair-finance' ),
				entryLabel( target )
			),
			onClick: () => handleSplit( target ),
		} );
		const matchAction = isMatched
			? {
					label: __( 'Unmatch', 'fair-finance' ),
					onClick: () => handleUnmatch( entry ),
				}
			: {
					label: __( 'Match', 'fair-finance' ),
					onClick: () => handleMatch( entry ),
				};
		const deleteAction = {
			label: __( 'Delete', 'fair-finance' ),
			isDestructive: true,
			onClick: () => deleteEntry.open( entry ),
		};

		if ( entry.parent_entry_id ) {
			return {
				primary: editSplitAction( entry.parent || entry ),
				secondary: [],
				moreLabel,
			};
		}
		if ( isTransfer ) {
			return {
				primary: editAction( () => handleEditTransfer( entry ) ),
				secondary: [ deleteAction ],
				moreLabel,
			};
		}
		if ( isSplit ) {
			return {
				primary: editSplitAction( entry ),
				secondary: [
					...( isClassified ? [] : [ matchAction ] ),
					{
						...deleteAction,
						disabled: true,
						disabledReason: __(
							'Unsplit this entry before deleting it.',
							'fair-finance'
						),
					},
				],
				moreLabel,
			};
		}
		return {
			primary: editAction( () => handleEdit( entry ) ),
			secondary: isClassified
				? [ deleteAction ]
				: [
						{
							label: __( 'Split', 'fair-finance' ),
							onClick: () => handleSplit( entry ),
						},
						matchAction,
						deleteAction,
					],
			moreLabel,
		};
	};

	const renderAllocationRow = ( child, parent, isTransfer ) => (
		<tr
			key={ `child-${ child.id }` }
			className="fair-finance-entries__allocation"
		>
			<AdminTableCell variant="identity">
				<ItemIdentity
					title={ child.description }
					fallback={ __( '(no description)', 'fair-finance' ) }
					meta={
						isTransfer
							? sprintf(
									/* translators: %s: transfer description */
									__(
										'Part of transfer “%s”',
										'fair-finance'
									),
									entryLabel( parent )
								)
							: sprintf(
									/* translators: %s: split entry description */
									__(
										'Part of split entry “%s”',
										'fair-finance'
									),
									entryLabel( parent )
								)
					}
				/>
			</AdminTableCell>
			{ emptyCell( 'date' ) }
			{ isTransfer ? (
				<AdminTableCell label={ columns.type }>
					{ renderType( child.entry_type ) }
				</AdminTableCell>
			) : (
				emptyCell( 'type' )
			) }
			<AdminTableCell label={ columns.amount } variant="amount">
				{ formatAmount( child.amount ) }
			</AdminTableCell>
			<AdminTableCell label={ columns.budget }>
				{ getBudgetName( child.budget_id ) }
			</AdminTableCell>
			{ eventsEnabled &&
				( child.event_url ? (
					<AdminTableCell label={ columns.link }>
						{ renderLink( child.event_url ) }
					</AdminTableCell>
				) : (
					emptyCell( 'link' )
				) ) }
			{ emptyCell( 'matched' ) }
			{ emptyCell( 'imported' ) }
			{ emptyCell( 'actions' ) }
		</tr>
	);

	const renderEntryRow = ( entry ) => {
		const isTransfer = entry.entry_type === 'transfer';
		const isSplit = ! isTransfer && entry.children?.length > 0;
		const hasAllocations = isTransfer
			? entry.children?.length > 0
			: isSplit;
		const isChild = !! entry.parent_entry_id;
		const isExpanded = !! expandedEntries[ entry.id ];
		const allocationCount = entry.children?.length || 0;

		return (
			<Fragment key={ entry.id }>
				<tr
					className={
						hasAllocations && isExpanded
							? 'fair-finance-entries__group is-expanded'
							: undefined
					}
				>
					<AdminTableCell variant="identity">
						<ItemIdentity
							title={ entry.description }
							fallback={ __(
								'(no description)',
								'fair-finance'
							) }
							meta={
								entry.tag
									? sprintf(
											/* translators: %s: tag label */
											__( 'Tag: %s', 'fair-finance' ),
											entry.tag
										)
									: undefined
							}
						>
							{ isChild && (
								<span className="fair-admin-table__identity-meta">
									{ entry.parent
										? sprintf(
												/* translators: %s: split entry description */
												__(
													'Part of split entry “%s”',
													'fair-finance'
												),
												entryLabel( entry.parent )
											)
										: __(
												'Part of a split entry',
												'fair-finance'
											) }
								</span>
							) }
							{ !! entry.payment_source && (
								<PaymentSourceNote entry={ entry } />
							) }
							{ entry.participant && (
								<span className="fair-admin-table__identity-meta">
									{ entry.participant.admin_url ? (
										<a href={ entry.participant.admin_url }>
											{ entry.participant.name }
										</a>
									) : (
										entry.participant.name
									) }
								</span>
							) }
							{ hasAllocations && (
								<Button
									variant="link"
									className="fair-finance-entries__toggle"
									aria-expanded={ isExpanded }
									onClick={ () => toggleExpanded( entry.id ) }
								>
									{ isExpanded
										? sprintf(
												/* translators: %d: number of allocations */
												_n(
													'Hide %d allocation',
													'Hide %d allocations',
													allocationCount,
													'fair-finance'
												),
												allocationCount
											)
										: sprintf(
												/* translators: %d: number of allocations */
												_n(
													'Show %d allocation',
													'Show %d allocations',
													allocationCount,
													'fair-finance'
												),
												allocationCount
											) }
								</Button>
							) }
						</ItemIdentity>
					</AdminTableCell>
					<AdminTableCell label={ columns.date }>
						<span className="fair-finance-entries__date">
							{ entry.entry_date }
						</span>
					</AdminTableCell>
					<AdminTableCell label={ columns.type }>
						{ renderType( entry.entry_type ) }
					</AdminTableCell>
					<AdminTableCell label={ columns.amount } variant="amount">
						<strong>{ formatAmount( entry.amount ) }</strong>
					</AdminTableCell>
					<AdminTableCell label={ columns.budget }>
						{ renderBudget( entry, isTransfer, isSplit ) }
					</AdminTableCell>
					{ eventsEnabled && (
						<AdminTableCell label={ columns.link }>
							{ renderLink( entry.event_url ) }
						</AdminTableCell>
					) }
					<AdminTableCell label={ columns.matched } variant="status">
						{ renderMatched( entry ) }
					</AdminTableCell>
					<AdminTableCell label={ columns.imported }>
						{ entry.imported_at ? (
							<span title={ entry.import_source || undefined }>
								{ entry.imported_at }
							</span>
						) : (
							noValue
						) }
					</AdminTableCell>
					<AdminTableCell label={ columns.actions } variant="actions">
						<RowActions { ...getRowActions( entry ) } />
					</AdminTableCell>
				</tr>
				{ hasAllocations &&
					isExpanded &&
					entry.children.map( ( child ) =>
						renderAllocationRow( child, entry, isTransfer )
					) }
			</Fragment>
		);
	};

	const loadErrorMessage = loadError && (
		<TableMessage
			status="error"
			onRetry={ retryLoad }
			retryLabel={ __( 'Try again', 'fair-finance' ) }
		>
			{ loadError }
		</TableMessage>
	);

	let listBody = null;
	if ( focus.invalid ) {
		listBody = null;
	} else if ( entries.length > 0 ) {
		listBody = (
			<>
				{ loadErrorMessage }
				{ loading && (
					<TableMessage status="loading">
						{ __( 'Loading entries…', 'fair-finance' ) }
					</TableMessage>
				) }
				<AdminTable
					caption={ __( 'Financial entries', 'fair-finance' ) }
					className="fair-finance-entries-table"
				>
					<thead>
						<tr>
							{ headerCell(
								columns.description,
								'',
								'identity'
							) }
							{ headerCell( columns.date, 'entry_date' ) }
							{ headerCell( columns.type ) }
							{ headerCell( columns.amount, 'amount', 'amount' ) }
							{ headerCell( columns.budget, 'budget_id' ) }
							{ eventsEnabled &&
								headerCell( columns.link, 'event_date_id' ) }
							{ headerCell( columns.matched, '', 'status' ) }
							{ headerCell( columns.imported, 'imported_at' ) }
							{ headerCell( columns.actions, '', 'actions' ) }
						</tr>
					</thead>
					<tbody aria-busy={ loading || undefined }>
						{ entries.map( renderEntryRow ) }
					</tbody>
				</AdminTable>
			</>
		);
	} else if ( loading ) {
		listBody = (
			<TableMessage status="loading">
				{ __( 'Loading entries…', 'fair-finance' ) }
			</TableMessage>
		);
	} else if ( loadError ) {
		listBody = loadErrorMessage;
	} else if ( hasLoaded && focus.id !== null ) {
		listBody = (
			<TableMessage status="empty">
				{ sprintf(
					/* translators: %d: financial entry ID. */
					__(
						'Entry #%d was not found. It may have been deleted.',
						'fair-finance'
					),
					focus.id
				) }
			</TableMessage>
		);
	} else if ( hasLoaded && hasActiveFilters ) {
		listBody = (
			<TableMessage
				status="no-results"
				onClear={ clearFilters }
				clearLabel={ __( 'Clear filters', 'fair-finance' ) }
			>
				{ __(
					'No entries match the selected filters.',
					'fair-finance'
				) }
			</TableMessage>
		);
	} else if ( hasLoaded ) {
		listBody = (
			<TableMessage status="empty">
				{ __(
					'No entries found. Add your first entry to start tracking costs and income.',
					'fair-finance'
				) }
			</TableMessage>
		);
	}

	return (
		<div className="wrap fair-finance-entries-page">
			<VStack spacing={ 4 }>
				{ /* Totals Summary */ }
				{ ! focus.invalid && (
					<Card>
						<CardBody>
							<HStack
								justify="space-around"
								className="fair-finance-entries-summary"
							>
								<div style={ { textAlign: 'center' } }>
									<div
										style={ {
											fontSize: '24px',
											fontWeight: 'bold',
											color: '#d63638',
										} }
									>
										{ formatAmount( totals.total_cost ) }
									</div>
									<div style={ { color: '#666' } }>
										{ __( 'Total Costs', 'fair-finance' ) }
									</div>
								</div>
								<div style={ { textAlign: 'center' } }>
									<div
										style={ {
											fontSize: '24px',
											fontWeight: 'bold',
											color: '#007017',
										} }
									>
										{ formatAmount( totals.total_income ) }
									</div>
									<div style={ { color: '#666' } }>
										{ __( 'Total Income', 'fair-finance' ) }
									</div>
								</div>
								<div style={ { textAlign: 'center' } }>
									<div
										style={ {
											fontSize: '24px',
											fontWeight: 'bold',
											color:
												totals.balance >= 0
													? '#007017'
													: '#d63638',
										} }
									>
										{ formatAmount( totals.balance ) }
									</div>
									<div style={ { color: '#666' } }>
										{ __( 'Balance', 'fair-finance' ) }
									</div>
								</div>
							</HStack>
						</CardBody>
					</Card>
				) }

				{ /* Tag Chart (global totals, hidden while focused) */ }
				{ ! isFocused && Object.keys( tagTotals ).length > 0 && (
					<Card>
						<CardBody>
							<TagChart data={ tagTotals } />
						</CardBody>
					</Card>
				) }

				{ /* Main Entries Card */ }
				<Card>
					<CardHeader>
						<HStack justify="space-between" wrap>
							<h1 ref={ headingRef } tabIndex={ -1 }>
								{ __( 'Financial Entries', 'fair-finance' ) }
							</h1>
							<div
								style={ {
									display: 'flex',
									flexWrap: 'wrap',
									gap: '8px',
								} }
							>
								<Button
									variant="primary"
									onClick={ handleCreate }
								>
									{ __( 'Add Entry', 'fair-finance' ) }
								</Button>
								<Button
									variant="secondary"
									onClick={ handleTransfer }
								>
									{ __( 'Transfer', 'fair-finance' ) }
								</Button>
								<Button
									variant="secondary"
									onClick={ handleImport }
								>
									{ __( 'Import', 'fair-finance' ) }
								</Button>
								<Button
									variant="secondary"
									onClick={ exportCsv }
									disabled={
										exportLoading || entries.length === 0
									}
									isBusy={ exportLoading }
								>
									{ __( 'Export CSV', 'fair-finance' ) }
								</Button>
							</div>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={ 4 }>
							{ /* Entries awaiting a budget (whole ledger) */ }
							<UnbudgetedCount
								state={ unbudgeted }
								onRetry={ loadUnbudgetedCount }
							/>

							{ /* Focused entry: replaces the filters */ }
							{ isFocused && (
								<Notice
									status={ focus.invalid ? 'error' : 'info' }
									isDismissible={ false }
									actions={ [
										{
											label: __(
												'Show all entries',
												'fair-finance'
											),
											onClick: clearFocus,
											variant: 'secondary',
										},
									] }
								>
									{ focus.invalid
										? __(
												'This entry link is not valid.',
												'fair-finance'
											)
										: sprintf(
												/* translators: %d: financial entry ID. */
												__(
													'Showing entry #%d',
													'fair-finance'
												),
												focus.id
											) }
								</Notice>
							) }

							{ /* Filters */ }
							{ ! isFocused && (
								<HStack spacing={ 3 } wrap>
									<TextControl
										label={ __(
											'From Date',
											'fair-finance'
										) }
										value={ filters.date_from }
										onChange={ ( value ) =>
											handleFilterChange(
												'date_from',
												value
											)
										}
										type="date"
									/>
									<TextControl
										label={ __(
											'To Date',
											'fair-finance'
										) }
										value={ filters.date_to }
										onChange={ ( value ) =>
											handleFilterChange(
												'date_to',
												value
											)
										}
										type="date"
									/>
									<SelectControl
										label={ __( 'Budget', 'fair-finance' ) }
										value={ filters.budget_id }
										options={ budgetOptions }
										onChange={ ( value ) =>
											handleFilterChange(
												'budget_id',
												value
											)
										}
									/>
									{ eventsEnabled &&
										eventFilterOptions.length > 0 && (
											<SelectControl
												label={ __(
													'Link',
													'fair-finance'
												) }
												value={ getEventFilterValue(
													filters
												) }
												options={ [
													{
														label: __(
															'All Links',
															'fair-finance'
														),
														value: '',
													},
													...eventFilterOptions,
												] }
												onChange={
													handleEventFilterChange
												}
											/>
										) }
									{ tags.length > 0 && (
										<SelectControl
											label={ __(
												'Tag',
												'fair-finance'
											) }
											value={ filters.tag }
											options={ [
												{
													label: __(
														'All Tags',
														'fair-finance'
													),
													value: '',
												},
												...tags.map( ( tag ) => ( {
													label: tag,
													value: tag,
												} ) ),
											] }
											onChange={ ( value ) =>
												handleFilterChange(
													'tag',
													value
												)
											}
										/>
									) }
									<SelectControl
										label={ __( 'Type', 'fair-finance' ) }
										value={ filters.entry_type }
										options={ [
											{
												label: __(
													'All Types',
													'fair-finance'
												),
												value: '',
											},
											{
												label: __(
													'Cost',
													'fair-finance'
												),
												value: 'cost',
											},
											{
												label: __(
													'Income',
													'fair-finance'
												),
												value: 'income',
											},
											{
												label: __(
													'Transfer',
													'fair-finance'
												),
												value: 'transfer',
											},
										] }
										onChange={ ( value ) =>
											handleFilterChange(
												'entry_type',
												value
											)
										}
									/>
									<SelectControl
										label={ __(
											'Matching',
											'fair-finance'
										) }
										value={
											filters.unmatched ? 'unmatched' : ''
										}
										options={ [
											{
												label: __(
													'All',
													'fair-finance'
												),
												value: '',
											},
											{
												label: __(
													'Unmatched Only',
													'fair-finance'
												),
												value: 'unmatched',
											},
										] }
										onChange={ ( value ) =>
											handleFilterChange(
												'unmatched',
												value === 'unmatched'
											)
										}
									/>
								</HStack>
							) }

							{ /* Notices */ }
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

							{ listBody }

							{ /* Pagination */ }
							{ ! focus.invalid &&
								entries.length > 0 &&
								pagination.pages > 1 && (
									<HStack justify="center" spacing={ 2 }>
										<Button
											variant="secondary"
											disabled={ pagination.page === 1 }
											onClick={ () =>
												handlePageChange(
													pagination.page - 1
												)
											}
										>
											{ __( 'Previous', 'fair-finance' ) }
										</Button>
										<span>
											{ __(
												'Page %1$d of %2$d',
												'fair-finance'
											)
												.replace(
													'%1$d',
													pagination.page
												)
												.replace(
													'%2$d',
													pagination.pages
												) }
										</span>
										<Button
											variant="secondary"
											disabled={
												pagination.page ===
												pagination.pages
											}
											onClick={ () =>
												handlePageChange(
													pagination.page + 1
												)
											}
										>
											{ __( 'Next', 'fair-finance' ) }
										</Button>
									</HStack>
								) }
						</VStack>
					</CardBody>
				</Card>
			</VStack>

			{ /* Entry Form Modal */ }
			{ isFormOpen && (
				<EntryForm
					entry={ editingEntry }
					budgets={ budgets }
					eventsEnabled={ eventsEnabled }
					tags={ tags }
					onSave={ handleFormSave }
					onCancel={ handleFormCancel }
				/>
			) }

			{ /* Match Modal */ }
			{ matchingEntry && (
				<MatchModal
					entry={ matchingEntry }
					onMatch={ handleMatchComplete }
					onCancel={ handleMatchCancel }
				/>
			) }

			{ /* Unmatch Modal */ }
			{ unmatchingEntry && (
				<UnmatchModal
					entry={ unmatchingEntry }
					onUnmatched={ handleUnmatchComplete }
					onCancel={ handleUnmatchCancel }
				/>
			) }

			{ /* Import Modal */ }
			{ isImportOpen && (
				<ImportModal
					onImport={ handleImportComplete }
					onCancel={ handleImportCancel }
				/>
			) }

			{ /* Split Modal */ }
			{ splittingEntry && (
				<SplitModal
					entry={ splittingEntry }
					budgets={ budgets }
					eventsEnabled={ eventsEnabled }
					onSplit={ handleSplitComplete }
					onCancel={ handleSplitCancel }
					onUnsplit={ () => unsplitEntry.open( splittingEntry ) }
					// Rendered inside the split editor: a sibling modal would
					// dismiss it, losing its edits when the unsplit is cancelled.
					confirmation={
						unsplitEntry.target && (
							<ConfirmActionModal
								title={ sprintf(
									/* translators: %s: financial entry description */
									__( 'Unsplit entry — %s', 'fair-finance' ),
									entryLabel( unsplitEntry.target )
								) }
								confirmLabel={ __(
									'Unsplit entry',
									'fair-finance'
								) }
								busyLabel={ __(
									'Unsplitting…',
									'fair-finance'
								) }
								isDestructive
								isBusy={ unsplitEntry.isBusy }
								error={ unsplitEntry.error }
								onConfirm={ handleUnsplit }
								onCancel={ unsplitEntry.close }
							>
								<p>{ entrySummary( unsplitEntry.target ) }</p>
								<p>
									{ sprintf(
										/* translators: %d: number of split allocations */
										_n(
											'This deletes its %d allocation:',
											'This deletes all %d of its allocations:',
											unsplitEntry.target.children
												?.length || 0,
											'fair-finance'
										),
										unsplitEntry.target.children?.length ||
											0
									) }
								</p>
								<ul>
									{ (
										unsplitEntry.target.children || []
									).map( ( child ) => (
										<li key={ child.id }>
											{ sprintf(
												/* translators: 1: allocation amount, 2: budget name */
												__(
													'%1$s to %2$s',
													'fair-finance'
												),
												formatAmount( child.amount ),
												child.budget_id
													? getBudgetName(
															child.budget_id
														)
													: __(
															'Unbudgeted',
															'fair-finance'
														)
											) }
										</li>
									) ) }
								</ul>
								<p>
									{ __(
										'The entry itself and its matched transactions are kept. You can split it again later.',
										'fair-finance'
									) }
								</p>
							</ConfirmActionModal>
						)
					}
				/>
			) }

			{ deleteEntry.target && (
				<ConfirmActionModal
					title={ sprintf(
						'transfer' === deleteEntry.target.entry_type
							? /* translators: %s: transfer description */
								__( 'Delete transfer — %s', 'fair-finance' )
							: /* translators: %s: financial entry description */
								__( 'Delete entry — %s', 'fair-finance' ),
						entryLabel( deleteEntry.target )
					) }
					confirmLabel={
						'transfer' === deleteEntry.target.entry_type
							? __( 'Delete transfer', 'fair-finance' )
							: __( 'Delete entry', 'fair-finance' )
					}
					busyLabel={ __( 'Deleting…', 'fair-finance' ) }
					isDestructive
					isBusy={ deleteEntry.isBusy }
					error={ deleteEntry.error }
					onConfirm={ handleDelete }
					onCancel={ deleteEntry.close }
				>
					<p>{ entrySummary( deleteEntry.target ) }</p>
					{ 'transfer' === deleteEntry.target.entry_type && (
						<p>
							{ __(
								'Both of its budget allocations are deleted with it.',
								'fair-finance'
							) }
						</p>
					) }
					{ deleteEntry.target.transaction_ids?.length > 0 && (
						<p>
							{ sprintf(
								/* translators: %d: number of matched transactions */
								_n(
									'It is matched to %d transaction, which is not deleted.',
									'It is matched to %d transactions, which are not deleted.',
									deleteEntry.target.transaction_ids.length,
									'fair-finance'
								),
								deleteEntry.target.transaction_ids.length
							) }
						</p>
					) }
					<p>{ __( 'This cannot be undone.', 'fair-finance' ) }</p>
				</ConfirmActionModal>
			) }

			{ /* Transfer Modal */ }
			{ isTransferOpen && (
				<TransferModal
					entry={ transferEntry }
					budgets={ budgets }
					eventsEnabled={ eventsEnabled }
					onSave={ handleTransferSave }
					onCancel={ handleTransferCancel }
				/>
			) }
		</div>
	);
};

export default EntriesApp;
