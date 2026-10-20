/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Spinner,
	Notice,
	CheckboxControl,
	Panel,
	PanelBody,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	TextControl,
	SelectControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import SavedSettlementReview, {
	DEFAULT_DESCRIPTION_FILTER,
	SavedSettlementSelector,
	stateLabel,
} from './components/SavedSettlementReview.js';
import { completenessBadge } from '../settlements/format.js';
import SettlementImportModal from './components/SettlementImportModal.js';
import AllocationProposal, {
	matchOutcome,
} from './components/AllocationProposal.js';
import { formatDateOnly } from 'fair-events-shared/src/dateTime.js';

const EntryDateLink = ( { entry } ) => (
	<a
		href={ `admin.php?page=fair-finance-entries&entry_id=${ entry.id }` }
		aria-label={ sprintf(
			/* translators: 1: financial entry ID, 2: entry date */
			__( 'Entry #%1$d, %2$s', 'fair-finance' ),
			entry.id,
			entry.entry_date
		) }
	>
		{ entry.entry_date }
	</a>
);

const formatAmount = ( amount, currency = 'EUR' ) => {
	return new Intl.NumberFormat( 'en-US', {
		style: 'currency',
		currency,
	} ).format( amount );
};

const settlementName = ( settlement ) =>
	settlement.reference ||
	settlement.provider_id ||
	sprintf(
		/* translators: %d: saved settlement ID. */
		__( 'Settlement #%d', 'fair-finance' ),
		settlement.id
	);

const settlementAmount = ( settlement ) =>
	settlement.amount === null || settlement.amount === undefined
		? __( 'Unknown', 'fair-finance' )
		: `${ settlement.amount } ${ settlement.currency || '' }`;

const NO_SETTLEMENT_SUGGESTIONS = {
	phase: 'idle',
	items: [],
	page: 1,
	pages: 1,
	total: 0,
	ambiguous: false,
	error: null,
};

const SettlementSuggestions = ( { state, onPage, onReview } ) => {
	if ( state.phase === 'loading' ) {
		return (
			<HStack justify="center">
				<Spinner />
				<Text>
					{ __( 'Finding saved settlements…', 'fair-finance' ) }
				</Text>
			</HStack>
		);
	}
	if ( state.phase === 'error' ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				{ state.error }
			</Notice>
		);
	}
	if ( state.items.length === 0 ) {
		return (
			<p>
				{ __(
					'No saved settlement has this payout reference or exact amount.',
					'fair-finance'
				) }
			</p>
		);
	}
	return (
		<VStack spacing={ 2 }>
			{ state.ambiguous && (
				<Notice status="info" isDismissible={ false }>
					{ __(
						'Several saved settlements have equally strong evidence. Review their references and account context before choosing one.',
						'fair-finance'
					) }
				</Notice>
			) }
			<ul className="fair-finance-settlement-suggestions">
				{ state.items.map( ( settlement ) => (
					<li key={ settlement.id }>
						<Text weight="bold">
							{ settlementName( settlement ) }
						</Text>
						<Text>
							{ [
								settlement.account?.label,
								settlementAmount( settlement ),
								settlement.settled_at
									? formatDateOnly(
											settlement.settled_at,
											'numeric'
										)
									: __( 'Date unknown', 'fair-finance' ),
								stateLabel( settlement.state ),
								completenessBadge( settlement.completeness )
									.label,
							]
								.filter( Boolean )
								.join( ' · ' ) }
						</Text>
						<ul>
							{ settlement.reasons.map( ( reason ) => (
								<li key={ reason }>{ reason }</li>
							) ) }
						</ul>
						{ settlement.context_mismatch && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'This bank entry has conflicting confirmed account or currency context.',
									'fair-finance'
								) }
							</Notice>
						) }
						<Button
							variant="secondary"
							size="small"
							onClick={ () => onReview( settlement ) }
						>
							{ __( 'Review settlement', 'fair-finance' ) }
						</Button>
					</li>
				) ) }
			</ul>
			{ state.pages > 1 && (
				<HStack justify="flex-start" wrap>
					<Button
						variant="tertiary"
						size="small"
						disabled={ state.page <= 1 }
						onClick={ () => onPage( state.page - 1 ) }
					>
						{ __( 'Previous suggestions', 'fair-finance' ) }
					</Button>
					<Text>
						{ sprintf(
							/* translators: 1: current page, 2: number of pages. */
							__( 'Page %1$d of %2$d', 'fair-finance' ),
							state.page,
							state.pages
						) }
					</Text>
					<Button
						variant="tertiary"
						size="small"
						disabled={ state.page >= state.pages }
						onClick={ () => onPage( state.page + 1 ) }
					>
						{ __( 'Next suggestions', 'fair-finance' ) }
					</Button>
				</HStack>
			) }
		</VStack>
	);
};

const ReconciliationApp = ( { onReviewSettlement = () => {} } ) => {
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );

	const [ unmatchedEntries, setUnmatchedEntries ] = useState( [] );
	const [ unmatchedTransactions, setUnmatchedTransactions ] = useState( [] );
	const [ matchedEntries, setMatchedEntries ] = useState( [] );

	const [ selectedEntry, setSelectedEntry ] = useState( null );
	const [ selectedTransactionIds, setSelectedTransactionIds ] = useState(
		[]
	);
	const [ suggestions, setSuggestions ] = useState( [] );
	const [ loadingSuggestions, setLoadingSuggestions ] = useState( false );
	const [ matching, setMatching ] = useState( false );
	const [ descriptionFilter, setDescriptionFilter ] = useState(
		DEFAULT_DESCRIPTION_FILTER
	);
	const [ settlementSuggestions, setSettlementSuggestions ] = useState(
		NO_SETTLEMENT_SUGGESTIONS
	);
	// Responses for an entry that is no longer selected are ignored.
	const suggestionsFor = useRef( null );
	const [ showSettlementModal, setShowSettlementModal ] = useState( false );
	// The server's allocation proposal for the current selection; responses
	// for an earlier selection are ignored.
	const [ matchPlan, setMatchPlan ] = useState( null );
	const matchPlanFor = useRef( 0 );

	const [ budgets, setBudgets ] = useState( [] );
	// '' means "no budget"; kept as a string throughout so it maps directly
	// to SelectControl's value.
	const [ selectedBudgetId, setSelectedBudgetId ] = useState( '' );
	// Once the administrator picks a budget explicitly, their choice sticks
	// even as the selection changes further — only re-selecting a different
	// entry resets it back to automatic.
	const [ budgetOverridden, setBudgetOverridden ] = useState( false );

	useEffect( () => {
		apiFetch( { path: '/fair-finance/v1/budgets' } )
			.then( ( data ) => setBudgets( data || [] ) )
			.catch( () => setBudgets( [] ) );
	}, [] );

	// Mollie connection status from Fair Payments Connector. Stays null
	// when the connector is inactive or too old to report it — that is not
	// the same as a connected account lacking the permission, so it shows
	// nothing here.
	const [ connectorStatus, setConnectorStatus ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/fair-payments-connector/v1/oauth/status' } )
			.then( ( status ) => setConnectorStatus( status ) )
			.catch( () => setConnectorStatus( null ) );
	}, [] );

	const needsSettlementAccess =
		connectorStatus !== null &&
		connectorStatus.connected === true &&
		connectorStatus.settlement_access !== true;

	// Recompute the proposed budget whenever the transaction selection
	// changes, unless the entry already has a budget (nothing to propose —
	// it's preserved) or the administrator already overrode the proposal.
	useEffect( () => {
		if ( ! selectedEntry || selectedEntry.budget_id || budgetOverridden ) {
			return;
		}

		const selectedTx = unmatchedTransactions.filter( ( t ) =>
			selectedTransactionIds.includes( t.id )
		);
		const sourceBudgetIds = selectedTx.map(
			( t ) => t.source_budget_id ?? null
		);
		const proposal =
			sourceBudgetIds.length > 0 &&
			sourceBudgetIds.every(
				( budgetIdValue ) =>
					null !== budgetIdValue &&
					budgetIdValue === sourceBudgetIds[ 0 ]
			)
				? String( sourceBudgetIds[ 0 ] )
				: '';

		setSelectedBudgetId( proposal );
	}, [
		selectedTransactionIds,
		unmatchedTransactions,
		selectedEntry,
		budgetOverridden,
	] );

	useEffect( () => {
		const request = ++matchPlanFor.current;
		setMatchPlan( null );
		if ( ! selectedEntry || selectedTransactionIds.length === 0 ) return;
		apiFetch( {
			path: `/fair-finance/v1/financial-entries/${ selectedEntry.id }/match-preview`,
			method: 'POST',
			data: { transaction_ids: selectedTransactionIds },
		} )
			.then( ( plan ) => {
				if ( request === matchPlanFor.current ) setMatchPlan( plan );
			} )
			.catch( () => {
				if ( request === matchPlanFor.current ) setMatchPlan( null );
			} );
	}, [ selectedEntry, selectedTransactionIds ] );

	const handleBudgetChange = ( value ) => {
		setSelectedBudgetId( value );
		setBudgetOverridden( true );
	};

	const filteredUnmatchedEntries = unmatchedEntries.filter( ( entry ) => {
		if ( ! descriptionFilter ) return true;
		return ( entry.description || '' )
			.toLowerCase()
			.includes( descriptionFilter.toLowerCase() );
	} );

	const loadData = useCallback( async () => {
		setLoading( true );
		setError( null );
		try {
			const data = await apiFetch( {
				path: '/fair-finance/v1/reconciliation',
			} );
			setUnmatchedEntries( data.unmatched_entries );
			setUnmatchedTransactions( data.unmatched_transactions );
			setMatchedEntries( data.matched_entries );
		} catch ( err ) {
			setError(
				err.message ||
					__( 'Failed to load reconciliation data.', 'fair-finance' )
			);
		} finally {
			setLoading( false );
		}
	}, [] );

	useEffect( () => {
		loadData();
	}, [ loadData ] );

	const loadSettlementSuggestions = async ( entryId, page = 1 ) => {
		suggestionsFor.current = entryId;
		setSettlementSuggestions( ( current ) => ( {
			...current,
			phase: 'loading',
			error: null,
		} ) );
		try {
			const data = await apiFetch( {
				path: `/fair-finance/v1/reconciliation/entries/${ entryId }/settlement-suggestions?page=${ page }`,
			} );
			if ( suggestionsFor.current !== entryId ) return;
			setSettlementSuggestions( {
				...NO_SETTLEMENT_SUGGESTIONS,
				phase: 'ready',
				items: data?.items || [],
				page: data?.page || page,
				pages: data?.pages || 1,
				total: data?.total || 0,
				ambiguous: Boolean( data?.ambiguous ),
			} );
		} catch ( err ) {
			if ( suggestionsFor.current !== entryId ) return;
			setSettlementSuggestions( {
				...NO_SETTLEMENT_SUGGESTIONS,
				phase: 'error',
				error:
					err.message ||
					__(
						'Saved settlement suggestions could not be loaded.',
						'fair-finance'
					),
			} );
		}
	};

	const handleSelectEntry = async ( entry ) => {
		loadSettlementSuggestions( entry.id );
		setSelectedEntry( entry );
		setSelectedTransactionIds( [] );
		setSuggestions( [] );
		setBudgetOverridden( false );
		setSelectedBudgetId( entry.budget_id ? String( entry.budget_id ) : '' );
		setLoadingSuggestions( true );

		try {
			const data = await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ entry.id }/suggest-matches`,
			} );
			setSuggestions( data );
		} catch ( err ) {
			// Suggestions are optional, don't block on error.
			setSuggestions( [] );
		} finally {
			setLoadingSuggestions( false );
		}
	};

	const handleToggleTransaction = ( transactionId ) => {
		setSelectedTransactionIds( ( prev ) =>
			prev.includes( transactionId )
				? prev.filter( ( id ) => id !== transactionId )
				: [ ...prev, transactionId ]
		);
	};

	const handleApplySuggestion = ( suggestion ) => {
		setSelectedTransactionIds( suggestion.transaction_ids );
	};

	const handleConfirmMatch = async () => {
		if ( ! selectedEntry || selectedTransactionIds.length === 0 ) return;

		setMatching( true );
		setError( null );
		try {
			const matched = await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ selectedEntry.id }/match`,
				method: 'POST',
				data: {
					transaction_ids: selectedTransactionIds,
					budget_id: selectedBudgetId
						? parseInt( selectedBudgetId, 10 )
						: null,
				},
			} );
			setSuccess( matchOutcome( matched?.allocation ) );
			setSelectedEntry( null );
			suggestionsFor.current = null;
			setSettlementSuggestions( NO_SETTLEMENT_SUGGESTIONS );
			setSelectedTransactionIds( [] );
			setSuggestions( [] );
			setSelectedBudgetId( '' );
			setBudgetOverridden( false );
			await loadData();
		} catch ( err ) {
			setError(
				err.message ||
					__( 'Failed to match transactions.', 'fair-finance' )
			);
		} finally {
			setMatching( false );
		}
	};

	const handleUnmatchTransaction = async ( entryId, transactionId ) => {
		setError( null );
		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ entryId }/match`,
				method: 'DELETE',
				data: { transaction_id: transactionId },
			} );
			setSuccess(
				__( 'Transaction unmatched successfully.', 'fair-finance' )
			);
			await loadData();
		} catch ( err ) {
			setError(
				err.message ||
					__( 'Failed to unmatch transaction.', 'fair-finance' )
			);
		}
	};

	const handleUnmatchAll = async ( entryId ) => {
		setError( null );
		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ entryId }/match`,
				method: 'DELETE',
			} );
			setSuccess(
				__( 'All transactions unmatched successfully.', 'fair-finance' )
			);
			await loadData();
		} catch ( err ) {
			setError(
				err.message ||
					__( 'Failed to unmatch transactions.', 'fair-finance' )
			);
		}
	};

	// Calculate running total of selected transactions.
	const selectedTotal = unmatchedTransactions
		.filter( ( t ) => selectedTransactionIds.includes( t.id ) )
		.reduce( ( sum, t ) => sum + parseFloat( t.amount ), 0 );

	const selectedNetTotal = unmatchedTransactions
		.filter( ( t ) => selectedTransactionIds.includes( t.id ) )
		.reduce( ( sum, t ) => {
			const net =
				parseFloat( t.amount ) -
				parseFloat( t.application_fee || 0 ) -
				parseFloat( t.mollie_fee || 0 );
			return sum + net;
		}, 0 );

	const selectedCurrency =
		unmatchedTransactions.find( ( t ) =>
			selectedTransactionIds.includes( t.id )
		)?.currency || '';

	if ( loading ) {
		return (
			<div className="wrap">
				<h1>{ __( 'Reconciliation', 'fair-finance' ) }</h1>
				<div style={ { textAlign: 'center', padding: '40px' } }>
					<Spinner />
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<HStack justify="space-between" alignment="center" wrap>
				<h1>{ __( 'Reconciliation', 'fair-finance' ) }</h1>
				<HStack justify="flex-end" expanded={ false } wrap>
					<Button
						variant="tertiary"
						href="admin.php?page=fair-finance-settlements"
					>
						{ __( 'Saved settlements', 'fair-finance' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ () => setShowSettlementModal( true ) }
					>
						{ __( 'Import settlement CSV', 'fair-finance' ) }
					</Button>
				</HStack>
			</HStack>

			{ showSettlementModal && (
				<SettlementImportModal
					onImport={ () => {
						setShowSettlementModal( false );
						setSuccess(
							__(
								'Settlement matched successfully.',
								'fair-finance'
							)
						);
						loadData();
					} }
					onCancel={ () => setShowSettlementModal( false ) }
				/>
			) }

			{ needsSettlementAccess && (
				<Notice
					status="warning"
					isDismissible={ false }
					actions={ [
						{
							label: __(
								'Open Mollie connection settings',
								'fair-finance'
							),
							url: 'admin.php?page=fair-payments-connector-settings',
						},
					] }
				>
					{ __(
						'Mollie has not authorized this site to read settlements yet, so they cannot be retrieved automatically. Reconnect to Mollie in the Fair Payments Connector settings to grant that permission. You can keep importing the settlement CSV in the meantime.',
						'fair-finance'
					) }
				</Notice>
			) }

			{ error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={ () => setError( null ) }
				>
					{ error }
				</Notice>
			) }

			{ success && (
				<Notice
					status="success"
					isDismissible
					onDismiss={ () => setSuccess( null ) }
				>
					{ success }
				</Notice>
			) }

			<div className="fair-finance-reconciliation-columns">
				{ /* Left panel: Unmatched Bank Entries */ }
				<div>
					<Panel>
						<PanelBody
							title={
								__( 'Unmatched Bank Entries', 'fair-finance' ) +
								` (${ filteredUnmatchedEntries.length }/${ unmatchedEntries.length })`
							}
							initialOpen={ true }
						>
							<TextControl
								label={ __(
									'Filter by description',
									'fair-finance'
								) }
								value={ descriptionFilter }
								onChange={ setDescriptionFilter }
								placeholder={ __(
									'Type to filter…',
									'fair-finance'
								) }
							/>
							{ filteredUnmatchedEntries.length === 0 ? (
								<p>
									{ __(
										'All bank entries are matched.',
										'fair-finance'
									) }
								</p>
							) : (
								<table
									className="wp-list-table widefat fixed striped"
									style={ { marginTop: 0 } }
								>
									<thead>
										<tr>
											<th>
												{ __( 'Date', 'fair-finance' ) }
											</th>
											<th>
												{ __(
													'Amount',
													'fair-finance'
												) }
											</th>
											<th>
												{ __( 'Type', 'fair-finance' ) }
											</th>
											<th>
												{ __(
													'Description',
													'fair-finance'
												) }
											</th>
											<th style={ { width: '80px' } }>
												{ __(
													'Action',
													'fair-finance'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ filteredUnmatchedEntries.map(
											( entry ) => (
												<tr
													key={ entry.id }
													style={ {
														background:
															selectedEntry?.id ===
															entry.id
																? '#e7f5fa'
																: undefined,
													} }
												>
													<td>
														<EntryDateLink
															entry={ entry }
														/>
													</td>
													<td>
														{ formatAmount(
															entry.amount
														) }
													</td>
													<td>
														{ entry.entry_type }
													</td>
													<td>
														{ entry.description || (
															<em>
																{ __(
																	'No description',
																	'fair-finance'
																) }
															</em>
														) }
													</td>
													<td>
														<Button
															variant={
																selectedEntry?.id ===
																entry.id
																	? 'primary'
																	: 'secondary'
															}
															size="small"
															onClick={ () =>
																handleSelectEntry(
																	entry
																)
															}
														>
															{ selectedEntry?.id ===
															entry.id
																? __(
																		'Selected',
																		'fair-finance'
																	)
																: __(
																		'Select',
																		'fair-finance'
																	) }
														</Button>
													</td>
												</tr>
											)
										) }
									</tbody>
								</table>
							) }
						</PanelBody>
					</Panel>
				</div>

				{ /* Right panel: Transactions for matching */ }
				<div>
					{ selectedEntry && (
						<Panel>
							<PanelBody
								title={ __(
									'Match Transactions',
									'fair-finance'
								) }
								initialOpen={ true }
							>
								<VStack spacing={ 4 }>
									{ /* Selected entry summary */ }
									<div
										style={ {
											background: '#f0f0f1',
											padding: '12px',
											borderRadius: '4px',
										} }
									>
										<Text>
											<strong>
												{ __(
													'Matching entry:',
													'fair-finance'
												) }
											</strong>{ ' ' }
											{ formatAmount(
												selectedEntry.amount
											) }{ ' ' }
											({ selectedEntry.entry_type }) -{ ' ' }
											{ selectedEntry.entry_date }
											{ selectedEntry.description &&
												` - ${ selectedEntry.description }` }
										</Text>
									</div>

									<div>
										<Text weight="bold">
											{ __(
												'Suggested settlements',
												'fair-finance'
											) }
										</Text>
										<SettlementSuggestions
											state={ settlementSuggestions }
											onPage={ ( page ) =>
												loadSettlementSuggestions(
													selectedEntry.id,
													page
												)
											}
											onReview={ ( settlement ) =>
												onReviewSettlement(
													settlement.id,
													selectedEntry.id
												)
											}
										/>
									</div>

									{ /* Auto-suggest results */ }
									{ loadingSuggestions && (
										<HStack justify="center">
											<Spinner />
											<Text>
												{ __(
													'Finding suggestions...',
													'fair-finance'
												) }
											</Text>
										</HStack>
									) }

									{ ! loadingSuggestions &&
										suggestions.length > 0 && (
											<div>
												<Text weight="bold">
													{ __(
														'Suggestions:',
														'fair-finance'
													) }
												</Text>
												{ suggestions.map(
													( suggestion, idx ) => (
														<div
															key={ idx }
															style={ {
																border: '1px solid #ccc',
																borderRadius:
																	'4px',
																padding: '8px',
																marginTop:
																	'8px',
																display: 'flex',
																justifyContent:
																	'space-between',
																alignItems:
																	'center',
															} }
														>
															<Text>
																{
																	suggestion
																		.transaction_ids
																		.length
																}{ ' ' }
																{ __(
																	'transactions',
																	'fair-finance'
																) }
																{ ' — ' }
																{ __(
																	'Net:',
																	'fair-finance'
																) }{ ' ' }
																{ formatAmount(
																	suggestion.net_amount
																) }
																{ ' (' }
																{ __(
																	'diff:',
																	'fair-finance'
																) }{ ' ' }
																{ formatAmount(
																	suggestion.difference
																) }
																{ ')' }
															</Text>
															<Button
																variant="secondary"
																size="small"
																onClick={ () =>
																	handleApplySuggestion(
																		suggestion
																	)
																}
															>
																{ __(
																	'Apply',
																	'fair-finance'
																) }
															</Button>
														</div>
													)
												) }
											</div>
										) }

									{ /* Running total */ }
									{ selectedTransactionIds.length > 0 && (
										<div
											style={ {
												background: '#f0f6fc',
												padding: '12px',
												borderRadius: '4px',
												border: '1px solid #c3d9ed',
											} }
										>
											<HStack>
												<VStack spacing={ 1 }>
													<Text>
														<strong>
															{ __(
																'Selected:',
																'fair-finance'
															) }
														</strong>{ ' ' }
														{
															selectedTransactionIds.length
														}{ ' ' }
														{ __(
															'transactions',
															'fair-finance'
														) }
													</Text>
													<Text>
														<strong>
															{ __(
																'Gross total:',
																'fair-finance'
															) }
														</strong>{ ' ' }
														{ formatAmount(
															selectedTotal
														) }
													</Text>
													<Text>
														<strong>
															{ __(
																'Net total (after fees):',
																'fair-finance'
															) }
														</strong>{ ' ' }
														{ formatAmount(
															selectedNetTotal
														) }
													</Text>
													<Text>
														<strong>
															{ __(
																'Difference from entry:',
																'fair-finance'
															) }
														</strong>{ ' ' }
														{ formatAmount(
															selectedNetTotal -
																selectedEntry.amount
														) }
													</Text>
												</VStack>
												<VStack spacing={ 2 }>
													<SelectControl
														label={ __(
															'Budget',
															'fair-finance'
														) }
														value={
															selectedBudgetId
														}
														disabled={ Boolean(
															selectedEntry.budget_id
														) }
														options={ [
															{
																label: __(
																	'No budget',
																	'fair-finance'
																),
																value: '',
															},
															...budgets.map(
																(
																	budget
																) => ( {
																	label: budget.name,
																	value: String(
																		budget.id
																	),
																} )
															),
														] }
														onChange={
															handleBudgetChange
														}
														help={
															selectedEntry.budget_id
																? __(
																		'This entry already has a budget; matching keeps it.',
																		'fair-finance'
																	)
																: __(
																		'Proposed from the selected transactions’ source; change it if needed.',
																		'fair-finance'
																	)
														}
														__nextHasNoMarginBottom
													/>
													<Button
														variant="primary"
														onClick={
															handleConfirmMatch
														}
														disabled={ matching }
														isBusy={ matching }
													>
														{ __(
															'Confirm Match',
															'fair-finance'
														) }
													</Button>
												</VStack>
											</HStack>
											<AllocationProposal
												allocation={ matchPlan }
												budgets={ budgets }
												currency={ selectedCurrency }
												reviewedBudget={
													selectedBudgetId
												}
											/>
										</div>
									) }

									{ /* Transaction list with checkboxes */ }
									{ unmatchedTransactions.length === 0 ? (
										<p>
											{ __(
												'No unmatched transactions found.',
												'fair-finance'
											) }
										</p>
									) : (
										<table
											className="wp-list-table widefat fixed striped"
											style={ { marginTop: 0 } }
										>
											<thead>
												<tr>
													<th
														style={ {
															width: '30px',
														} }
													></th>
													<th>
														{ __(
															'Date',
															'fair-finance'
														) }
													</th>
													<th>
														{ __(
															'Amount',
															'fair-finance'
														) }
													</th>
													<th>
														{ __(
															'Net',
															'fair-finance'
														) }
													</th>
													<th>
														{ __(
															'Description',
															'fair-finance'
														) }
													</th>
													<th>
														{ __(
															'Mollie ID',
															'fair-finance'
														) }
													</th>
												</tr>
											</thead>
											<tbody>
												{ unmatchedTransactions.map(
													( t ) => {
														const net =
															parseFloat(
																t.amount
															) -
															parseFloat(
																t.application_fee ||
																	0
															) -
															parseFloat(
																t.mollie_fee ||
																	0
															);
														return (
															<tr key={ t.id }>
																<td>
																	<CheckboxControl
																		checked={ selectedTransactionIds.includes(
																			t.id
																		) }
																		onChange={ () =>
																			handleToggleTransaction(
																				t.id
																			)
																		}
																		__nextHasNoMarginBottom
																	/>
																</td>
																<td>
																	{ formatDateOnly(
																		t.created_at,
																		'numeric'
																	) }
																</td>
																<td>
																	{ formatAmount(
																		t.amount,
																		t.currency
																	) }
																</td>
																<td>
																	{ formatAmount(
																		net,
																		t.currency
																	) }
																</td>
																<td>
																	{ t.description || (
																		<em>
																			{ __(
																				'No description',
																				'fair-finance'
																			) }
																		</em>
																	) }
																</td>
																<td>
																	<code
																		style={ {
																			fontSize:
																				'11px',
																		} }
																	>
																		{
																			t.mollie_payment_id
																		}
																	</code>
																</td>
															</tr>
														);
													}
												) }
											</tbody>
										</table>
									) }
								</VStack>
							</PanelBody>
						</Panel>
					) }

					{ ! selectedEntry && (
						<Panel>
							<PanelBody
								title={ __(
									'Match Transactions',
									'fair-finance'
								) }
								initialOpen={ true }
							>
								<p>
									{ __(
										'Select a bank entry from the left panel to start matching.',
										'fair-finance'
									) }
								</p>
							</PanelBody>
						</Panel>
					) }
				</div>
			</div>

			{ /* Matched entries section */ }
			<div style={ { marginTop: '30px' } }>
				<Panel>
					<PanelBody
						title={
							__( 'Matched Entries', 'fair-finance' ) +
							` (${ matchedEntries.length })`
						}
						initialOpen={ false }
					>
						{ matchedEntries.length === 0 ? (
							<p>
								{ __(
									'No matched entries yet.',
									'fair-finance'
								) }
							</p>
						) : (
							matchedEntries.map( ( entry ) => (
								<div
									key={ entry.id }
									style={ {
										border: '1px solid #ddd',
										borderRadius: '4px',
										padding: '12px',
										marginBottom: '12px',
									} }
								>
									<HStack justify="space-between" wrap>
										<VStack spacing={ 1 }>
											<Text weight="bold">
												{ formatAmount( entry.amount ) }{ ' ' }
												({ entry.entry_type }) -{ ' ' }
												<EntryDateLink
													entry={ entry }
												/>
												{ entry.description &&
													` - ${ entry.description }` }
											</Text>
											<Text>
												{ entry.transactions?.length ||
													0 }{ ' ' }
												{ __(
													'matched transactions',
													'fair-finance'
												) }
											</Text>
											{ entry.settlement && (
												<Text>
													{ sprintf(
														/* translators: 1: payout reference or settlement ID, 2: payout amount and currency, 3: reconciliation state. */
														__(
															'Settlement %1$s · %2$s · %3$s',
															'fair-finance'
														),
														settlementName(
															entry.settlement
														),
														settlementAmount(
															entry.settlement
														),
														stateLabel(
															entry.settlement
																.current_state
														)
													) }
												</Text>
											) }
										</VStack>
										{ entry.settlement ? (
											<Button
												variant="secondary"
												size="small"
												onClick={ () =>
													onReviewSettlement(
														entry.settlement.id
													)
												}
											>
												{ __(
													'Review settlement',
													'fair-finance'
												) }
											</Button>
										) : (
											<Button
												variant="tertiary"
												isDestructive
												size="small"
												onClick={ () =>
													handleUnmatchAll( entry.id )
												}
											>
												{ __(
													'Unmatch All',
													'fair-finance'
												) }
											</Button>
										) }
									</HStack>

									{ entry.transactions &&
										entry.transactions.length > 0 && (
											<table
												className="wp-list-table widefat fixed striped"
												style={ { marginTop: '8px' } }
											>
												<thead>
													<tr>
														<th>
															{ __(
																'Date',
																'fair-finance'
															) }
														</th>
														<th>
															{ __(
																'Amount',
																'fair-finance'
															) }
														</th>
														<th>
															{ __(
																'Description',
																'fair-finance'
															) }
														</th>
														<th>
															{ __(
																'Mollie ID',
																'fair-finance'
															) }
														</th>
														<th
															style={ {
																width: '100px',
															} }
														>
															{ __(
																'Action',
																'fair-finance'
															) }
														</th>
													</tr>
												</thead>
												<tbody>
													{ entry.transactions.map(
														( t ) => (
															<tr key={ t.id }>
																<td>
																	{ formatDateOnly(
																		t.created_at,
																		'numeric'
																	) }
																</td>
																<td>
																	{ formatAmount(
																		t.amount,
																		t.currency
																	) }
																</td>
																<td>
																	{ t.description ||
																		'' }
																</td>
																<td>
																	<code
																		style={ {
																			fontSize:
																				'11px',
																		} }
																	>
																		{
																			t.mollie_payment_id
																		}
																	</code>
																</td>
																<td>
																	{ ! entry.settlement && (
																		<Button
																			variant="tertiary"
																			isDestructive
																			size="small"
																			onClick={ () =>
																				handleUnmatchTransaction(
																					entry.id,
																					t.id
																				)
																			}
																		>
																			{ __(
																				'Unmatch',
																				'fair-finance'
																			) }
																		</Button>
																	) }
																</td>
															</tr>
														)
													) }
												</tbody>
											</table>
										) }
								</div>
							) )
						) }
					</PanelBody>
				</Panel>
			</div>
		</div>
	);
};

const ReconciliationPage = () => {
	const param = ( name ) => {
		const value = new URLSearchParams( window.location.search ).get( name );
		return /^\d+$/.test( value || '' ) ? value : '';
	};
	const [ settlementId, setSettlementId ] = useState( () =>
		param( 'settlement' )
	);
	// A bank entry carried from the main screen into the review.
	const [ entryId, setEntryId ] = useState( () =>
		param( 'settlement' ) ? param( 'entry_id' ) : ''
	);
	const select = ( value, entry = '' ) => {
		const next = value ? String( entry || '' ) : '';
		setSettlementId( value ? String( value ) : '' );
		setEntryId( next );
		const url = new URL( window.location.href );
		if ( value ) url.searchParams.set( 'settlement', value );
		else url.searchParams.delete( 'settlement' );
		if ( next ) url.searchParams.set( 'entry_id', next );
		else url.searchParams.delete( 'entry_id' );
		window.history.replaceState( null, '', url );
	};
	return (
		<>
			<div className="wrap">
				{ settlementId && (
					<h1>{ __( 'Reconciliation', 'fair-finance' ) }</h1>
				) }
				<SavedSettlementSelector
					value={ settlementId }
					onChange={ ( value ) => select( value ) }
				/>
				{ settlementId && (
					<SavedSettlementReview
						key={ `${ settlementId }:${ entryId }` }
						settlementId={ settlementId }
						proposedEntryId={ entryId }
					/>
				) }
			</div>
			{ ! settlementId && (
				<ReconciliationApp onReviewSettlement={ select } />
			) }
		</>
	);
};
export default ReconciliationPage;
