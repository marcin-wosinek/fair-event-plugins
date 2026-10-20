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
import { __, sprintf } from '@wordpress/i18n';
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
import ImportModal from './components/ImportModal.js';
import SplitModal from './components/SplitModal.js';
import TransferModal from './components/TransferModal.js';
import TagChart from './components/TagChart.js';
import { buildEntriesCsv, downloadCsv } from './exportEntriesCsv.js';

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

const EntriesApp = () => {
	// Focus is read before the first data request so a focused link never
	// loads the full list first.
	const [ focus, setFocus ] = useState( readFocusFromUrl );
	const isFocused = focus.id !== null || focus.invalid;
	const entriesRequestRef = useRef( 0 );
	const totalsRequestRef = useRef( 0 );
	const [ entries, setEntries ] = useState( [] );
	const [ budgets, setBudgets ] = useState( [] );
	const [ eventUrls, setEventUrls ] = useState( [] );
	const [ eventDateOptions, setEventDateOptions ] = useState( [] );
	const [ tags, setTags ] = useState( [] );
	const [ tagTotals, setTagTotals ] = useState( {} );
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
	const [ exportLoading, setExportLoading ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );

	// Modal states
	const [ isFormOpen, setIsFormOpen ] = useState( false );
	const [ editingEntry, setEditingEntry ] = useState( null );
	const [ matchingEntry, setMatchingEntry ] = useState( null );
	const [ isImportOpen, setIsImportOpen ] = useState( false );
	const [ splittingEntry, setSplittingEntry ] = useState( null );
	const [ isTransferOpen, setIsTransferOpen ] = useState( false );
	const [ transferEntry, setTransferEntry ] = useState( null );
	const [ expandedEntries, setExpandedEntries ] = useState( {} );

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
				setEventDateOptions( [] );
				return;
			}
			try {
				const events = await apiFetch( {
					path: `/fair-events/v1/event-dates/batch?ids=${ ids.join(
						','
					) }`,
				} );
				setEventDateOptions(
					events.map( ( event ) => ( {
						label:
							event.title ||
							getEventUrlLabel( event.display_url || '' ),
						value: event.id.toString(),
					} ) )
				);
			} catch {
				// fair-events not available, fall back to bare IDs.
				setEventDateOptions(
					ids.map( ( id ) => ( {
						label: `#${ id }`,
						value: id.toString(),
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

	const loadEntries = async () => {
		// Only the latest request may update the list, so a slow response
		// for a previous view (e.g. before focus was cleared) is dropped.
		const requestId = ++entriesRequestRef.current;
		setLoading( true );
		setError( null );

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
			setPagination( ( prev ) => ( {
				...prev,
				total: data.total,
				pages: data.pages,
			} ) );
		} catch ( err ) {
			if ( requestId !== entriesRequestRef.current ) {
				return;
			}
			setEntries( [] );
			setError(
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

	const handleDelete = async ( id ) => {
		if (
			! window.confirm(
				__(
					'Are you sure you want to delete this entry?',
					'fair-finance'
				)
			)
		) {
			return;
		}

		setError( null );
		setSuccess( null );

		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ id }`,
				method: 'DELETE',
			} );
			setSuccess( __( 'Entry deleted successfully.', 'fair-finance' ) );
			loadEntries();
			loadTotals();
			if ( eventsEnabled ) {
				loadEventUrls();
				loadEventDateOptions();
			}
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to delete entry.', 'fair-finance' )
			);
		}
	};

	const handleFormSave = () => {
		setIsFormOpen( false );
		setEditingEntry( null );
		setSuccess(
			editingEntry
				? __( 'Entry updated successfully.', 'fair-finance' )
				: __( 'Entry created successfully.', 'fair-finance' )
		);
		loadEntries();
		loadTotals();
		loadTags();
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

	const handleUnmatch = async ( id ) => {
		if (
			! window.confirm(
				__(
					'Are you sure you want to unmatch this entry from its transaction?',
					'fair-finance'
				)
			)
		) {
			return;
		}

		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ id }/match`,
				method: 'DELETE',
			} );
			setSuccess( __( 'Entry unmatched successfully.', 'fair-finance' ) );
			loadEntries();
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to unmatch entry.', 'fair-finance' )
			);
		}
	};

	const handleMatchComplete = () => {
		setMatchingEntry( null );
		setSuccess( __( 'Entry matched to transaction.', 'fair-finance' ) );
		loadEntries();
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
		loadEntries();
		loadTotals();
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
		loadEntries();
		loadTotals();
		if ( eventsEnabled ) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleSplitCancel = () => {
		setSplittingEntry( null );
	};

	const handleUnsplit = async ( id ) => {
		if (
			! window.confirm(
				__(
					'Are you sure you want to unsplit this entry? All child allocations will be deleted.',
					'fair-finance'
				)
			)
		) {
			return;
		}

		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ id }/split`,
				method: 'DELETE',
			} );
			setSplittingEntry( null );
			setSuccess( __( 'Entry unsplit successfully.', 'fair-finance' ) );
			loadEntries();
			loadTotals();
			if ( eventsEnabled ) {
				loadEventUrls();
				loadEventDateOptions();
			}
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to unsplit entry.', 'fair-finance' )
			);
		}
	};

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
		loadEntries();
		loadTotals();
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

	const SortableHeader = ( { column, children } ) => {
		const isActive = sort.orderby === column;
		const arrow = isActive
			? sort.order === 'asc'
				? ' \u25B2'
				: ' \u25BC'
			: '';
		return (
			<th
				style={ { cursor: 'pointer', userSelect: 'none' } }
				onClick={ () => handleSort( column ) }
			>
				{ children }
				{ arrow }
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
		return budget ? budget.name : '-';
	};

	const budgetOptions = [
		{ label: __( 'All Budgets', 'fair-finance' ), value: '' },
		...budgets.map( ( budget ) => ( {
			label: budget.name,
			value: budget.id.toString(),
		} ) ),
		{ label: __( 'Unbudgeted', 'fair-finance' ), value: 'none' },
	];

	const eventUrlOptions = [
		{ label: __( 'All Links', 'fair-finance' ), value: '' },
		...eventUrls.map( ( url ) => ( {
			label: getEventUrlLabel( url ),
			value: url,
		} ) ),
	];

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
						<HStack justify="space-between">
							<h1>
								{ __( 'Financial Entries', 'fair-finance' ) }
							</h1>
							<div style={ { display: 'flex', gap: '8px' } }>
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
										eventDateOptions.length > 0 && (
											<SelectControl
												label={ __(
													'Link',
													'fair-finance'
												) }
												value={ filters.event_date_id }
												options={ [
													{
														label: __(
															'All Links',
															'fair-finance'
														),
														value: '',
													},
													...eventDateOptions,
												] }
												onChange={ ( value ) =>
													handleFilterChange(
														'event_date_id',
														value
													)
												}
											/>
										) }
									{ eventsEnabled &&
										eventDateOptions.length === 0 &&
										eventUrls.length > 0 && (
											<SelectControl
												label={ __(
													'Link',
													'fair-finance'
												) }
												value={ filters.event_url }
												options={ eventUrlOptions }
												onChange={ ( value ) =>
													handleFilterChange(
														'event_url',
														value
													)
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

							{ /* Loading */ }
							{ loading && (
								<div
									style={ {
										textAlign: 'center',
										padding: '20px',
									} }
								>
									<Spinner />
									<p>
										{ __(
											'Loading entries...',
											'fair-finance'
										) }
									</p>
								</div>
							) }

							{ /* Empty State */ }
							{ ! loading &&
								! error &&
								! focus.invalid &&
								entries.length === 0 && (
									<div
										style={ {
											textAlign: 'center',
											padding: '20px',
										} }
									>
										<p>
											{ focus.id !== null
												? sprintf(
														/* translators: %d: financial entry ID. */
														__(
															'Entry #%d was not found. It may have been deleted.',
															'fair-finance'
														),
														focus.id
													)
												: __(
														'No entries found. Add your first entry to start tracking costs and income.',
														'fair-finance'
													) }
										</p>
									</div>
								) }

							{ /* Entries Table */ }
							{ ! loading && entries.length > 0 && (
								<>
									<div style={ { overflowX: 'auto' } }>
										<table className="wp-list-table widefat striped">
											<thead>
												<tr>
													<SortableHeader column="entry_date">
														{ __(
															'Date',
															'fair-finance'
														) }
													</SortableHeader>
													<th>
														{ __(
															'Type',
															'fair-finance'
														) }
													</th>
													<SortableHeader column="amount">
														{ __(
															'Amount',
															'fair-finance'
														) }
													</SortableHeader>
													<th>
														{ __(
															'Description',
															'fair-finance'
														) }
													</th>
													<SortableHeader column="budget_id">
														{ __(
															'Budget',
															'fair-finance'
														) }
													</SortableHeader>
													{ eventsEnabled && (
														<SortableHeader column="event_date_id">
															{ __(
																'Link',
																'fair-finance'
															) }
														</SortableHeader>
													) }
													<th>
														{ __(
															'Matched',
															'fair-finance'
														) }
													</th>
													<SortableHeader column="imported_at">
														{ __(
															'Imported',
															'fair-finance'
														) }
													</SortableHeader>
													<th>
														{ __(
															'Actions',
															'fair-finance'
														) }
													</th>
												</tr>
											</thead>
											<tbody>
												{ entries.map( ( entry ) => {
													const isTransfer =
														entry.entry_type ===
														'transfer';
													const isSplit =
														! isTransfer &&
														entry.children &&
														entry.children.length >
															0;
													const isChild =
														!! entry.parent_entry_id;
													const isExpanded =
														expandedEntries[
															entry.id
														];

													return (
														<Fragment
															key={ entry.id }
														>
															<tr>
																<td>
																	{
																		entry.entry_date
																	}
																</td>
																<td>
																	<span
																		style={ {
																			color: isTransfer
																				? '#2271b1'
																				: entry.entry_type ===
																					  'cost'
																					? '#d63638'
																					: '#007017',
																			fontWeight:
																				'bold',
																		} }
																	>
																		{ isTransfer
																			? __(
																					'Transfer',
																					'fair-finance'
																				)
																			: entry.entry_type ===
																				  'cost'
																				? __(
																						'Cost',
																						'fair-finance'
																					)
																				: __(
																						'Income',
																						'fair-finance'
																					) }
																	</span>
																</td>
																<td>
																	<strong>
																		{ formatAmount(
																			entry.amount
																		) }
																	</strong>
																	{ isChild && (
																		<span
																			style={ {
																				marginLeft:
																					'4px',
																				color: '#2271b1',
																				fontSize:
																					'12px',
																			} }
																		>
																			{ __(
																				'(split)',
																				'fair-finance'
																			) }
																		</span>
																	) }
																</td>
																<td>
																	{ entry.description || (
																		<em>
																			-
																		</em>
																	) }
																	{ entry.participant && (
																		<div
																			style={ {
																				fontSize:
																					'12px',
																				color: '#757575',
																				marginTop:
																					'2px',
																			} }
																		>
																			{ entry
																				.participant
																				.admin_url ? (
																				<a
																					href={
																						entry
																							.participant
																							.admin_url
																					}
																					style={ {
																						color: '#2271b1',
																						textDecoration:
																							'none',
																					} }
																				>
																					{
																						entry
																							.participant
																							.name
																					}
																				</a>
																			) : (
																				entry
																					.participant
																					.name
																			) }
																		</div>
																	) }
																</td>
																<td>
																	{ isTransfer ? (
																		( () => {
																			const costChild =
																				entry.children?.find(
																					(
																						c
																					) =>
																						c.entry_type ===
																						'cost'
																				);
																			const incomeChild =
																				entry.children?.find(
																					(
																						c
																					) =>
																						c.entry_type ===
																						'income'
																				);
																			return (
																				<span
																					style={ {
																						fontSize:
																							'12px',
																						lineHeight:
																							'1.4',
																					} }
																				>
																					{ getBudgetName(
																						costChild?.budget_id
																					) }
																					<br />
																					→
																					<br />
																					{ getBudgetName(
																						incomeChild?.budget_id
																					) }
																				</span>
																			);
																		} )()
																	) : isSplit ? (
																		<Button
																			variant="link"
																			size="small"
																			onClick={ () =>
																				toggleExpanded(
																					entry.id
																				)
																			}
																			style={ {
																				color: '#2271b1',
																				fontWeight:
																					'bold',
																			} }
																		>
																			{ isExpanded
																				? __(
																						'Split \u25BE',
																						'fair-finance'
																					)
																				: __(
																						'Split \u25B8',
																						'fair-finance'
																					) }
																		</Button>
																	) : (
																		getBudgetName(
																			entry.budget_id
																		)
																	) }
																</td>

																{ eventsEnabled && (
																	<td>
																		{ entry.event_url ? (
																			<a
																				href={
																					entry.event_url
																				}
																				target="_blank"
																				rel="noopener noreferrer"
																				title={
																					entry.event_url
																				}
																				style={ {
																					fontSize:
																						'13px',
																				} }
																			>
																				{ getEventUrlLabel(
																					entry.event_url
																				) }
																			</a>
																		) : isTransfer ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={ () =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={ {
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				} }
																			>
																				{ isExpanded
																					? __(
																							'Transfer \u25BE',
																							'fair-finance'
																						)
																					: __(
																							'Transfer \u25B8',
																							'fair-finance'
																						) }
																			</Button>
																		) : isSplit ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={ () =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={ {
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				} }
																			>
																				{ isExpanded
																					? __(
																							'Split \u25BE',
																							'fair-finance'
																						)
																					: __(
																							'Split \u25B8',
																							'fair-finance'
																						) }
																			</Button>
																		) : (
																			<em>
																				-
																			</em>
																		) }
																	</td>
																) }
																<td>
																	{ entry.transaction_ids &&
																	entry
																		.transaction_ids
																		.length >
																		0 ? (
																		<span
																			style={ {
																				color: '#007017',
																			} }
																		>
																			{ entry
																				.transaction_ids
																				.length >
																			1
																				? /* translators: %d: number of matched transactions */
																					sprintf(
																						__(
																							'Yes (%d)',
																							'fair-finance'
																						),
																						entry
																							.transaction_ids
																							.length
																					)
																				: __(
																						'Yes',
																						'fair-finance'
																					) }
																		</span>
																	) : (
																		<span
																			style={ {
																				color: '#996800',
																			} }
																		>
																			{ __(
																				'No',
																				'fair-finance'
																			) }
																		</span>
																	) }
																</td>
																<td
																	title={
																		entry.import_source ||
																		''
																	}
																>
																	{ entry.imported_at || (
																		<em>
																			-
																		</em>
																	) }
																</td>
																<td>
																	{ isChild ? (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={ () =>
																					handleSplit(
																						entry.parent
																					)
																				}
																			>
																				{ __(
																					'Edit Split',
																					'fair-finance'
																				) }
																			</Button>
																		</HStack>
																	) : isTransfer ? (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={ () =>
																					handleEditTransfer(
																						entry
																					)
																				}
																			>
																				{ __(
																					'Edit',
																					'fair-finance'
																				) }
																			</Button>
																			<Button
																				variant="tertiary"
																				size="small"
																				isDestructive
																				onClick={ () =>
																					handleDelete(
																						entry.id
																					)
																				}
																			>
																				{ __(
																					'Delete',
																					'fair-finance'
																				) }
																			</Button>
																		</HStack>
																	) : (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={ () =>
																					handleEdit(
																						entry
																					)
																				}
																				disabled={
																					isSplit
																				}
																			>
																				{ __(
																					'Edit',
																					'fair-finance'
																				) }
																			</Button>
																			{ isSplit ? (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={ () =>
																						handleSplit(
																							entry
																						)
																					}
																				>
																					{ __(
																						'Edit Split',
																						'fair-finance'
																					) }
																				</Button>
																			) : (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={ () =>
																						handleSplit(
																							entry
																						)
																					}
																				>
																					{ __(
																						'Split',
																						'fair-finance'
																					) }
																				</Button>
																			) }
																			{ entry.transaction_ids &&
																			entry
																				.transaction_ids
																				.length >
																				0 ? (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={ () =>
																						handleUnmatch(
																							entry.id
																						)
																					}
																				>
																					{ __(
																						'Unmatch',
																						'fair-finance'
																					) }
																				</Button>
																			) : (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={ () =>
																						handleMatch(
																							entry
																						)
																					}
																				>
																					{ __(
																						'Match',
																						'fair-finance'
																					) }
																				</Button>
																			) }
																			<Button
																				variant="tertiary"
																				size="small"
																				isDestructive
																				onClick={ () =>
																					handleDelete(
																						entry.id
																					)
																				}
																				disabled={
																					isSplit
																				}
																			>
																				{ __(
																					'Delete',
																					'fair-finance'
																				) }
																			</Button>
																		</HStack>
																	) }
																</td>
															</tr>
															{ isTransfer &&
																isExpanded &&
																entry.children &&
																entry.children.map(
																	(
																		child
																	) => (
																		<tr
																			key={ `child-${ child.id }` }
																			style={ {
																				backgroundColor:
																					'#f6f7f7',
																			} }
																		>
																			<td></td>
																			<td>
																				<span
																					style={ {
																						color:
																							child.entry_type ===
																							'cost'
																								? '#d63638'
																								: '#007017',
																						fontSize:
																							'13px',
																					} }
																				>
																					{ child.entry_type ===
																					'cost'
																						? __(
																								'Cost',
																								'fair-finance'
																							)
																						: __(
																								'Income',
																								'fair-finance'
																							) }
																				</span>
																			</td>
																			<td
																				style={ {
																					paddingLeft:
																						'20px',
																				} }
																			>
																				{ formatAmount(
																					child.amount
																				) }
																			</td>
																			<td
																				style={ {
																					color: '#666',
																					fontSize:
																						'13px',
																				} }
																			>
																				{ child.description || (
																					<em>
																						-
																					</em>
																				) }
																			</td>
																			<td>
																				{ getBudgetName(
																					child.budget_id
																				) }
																			</td>

																			{ eventsEnabled && (
																				<td>
																					{ child.event_url ? (
																						<a
																							href={
																								child.event_url
																							}
																							target="_blank"
																							rel="noopener noreferrer"
																							title={
																								child.event_url
																							}
																							style={ {
																								fontSize:
																									'12px',
																							} }
																						>
																							{ getEventUrlLabel(
																								child.event_url
																							) }
																						</a>
																					) : (
																						<em>
																							-
																						</em>
																					) }
																				</td>
																			) }
																			<td
																				colSpan={
																					3
																				}
																			></td>
																		</tr>
																	)
																) }
															{ isSplit &&
																isExpanded &&
																entry.children.map(
																	(
																		child
																	) => (
																		<tr
																			key={ `child-${ child.id }` }
																			style={ {
																				backgroundColor:
																					'#f6f7f7',
																			} }
																		>
																			<td></td>
																			<td></td>
																			<td
																				style={ {
																					paddingLeft:
																						'20px',
																				} }
																			>
																				{ formatAmount(
																					child.amount
																				) }
																			</td>
																			<td
																				style={ {
																					color: '#666',
																					fontSize:
																						'13px',
																				} }
																			>
																				{ child.description || (
																					<em>
																						-
																					</em>
																				) }
																			</td>
																			<td>
																				{ getBudgetName(
																					child.budget_id
																				) }
																			</td>

																			{ eventsEnabled && (
																				<td>
																					{ child.event_url ? (
																						<a
																							href={
																								child.event_url
																							}
																							target="_blank"
																							rel="noopener noreferrer"
																							title={
																								child.event_url
																							}
																							style={ {
																								fontSize:
																									'12px',
																							} }
																						>
																							{ getEventUrlLabel(
																								child.event_url
																							) }
																						</a>
																					) : (
																						<em>
																							-
																						</em>
																					) }
																				</td>
																			) }
																			<td
																				colSpan={
																					3
																				}
																			></td>
																		</tr>
																	)
																) }
														</Fragment>
													);
												} ) }
											</tbody>
										</table>
									</div>

									{ /* Pagination */ }
									{ pagination.pages > 1 && (
										<HStack justify="center" spacing={ 2 }>
											<Button
												variant="secondary"
												disabled={
													pagination.page === 1
												}
												onClick={ () =>
													handlePageChange(
														pagination.page - 1
													)
												}
											>
												{ __(
													'Previous',
													'fair-finance'
												) }
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
								</>
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
					onUnsplit={ () => handleUnsplit( splittingEntry.id ) }
				/>
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
