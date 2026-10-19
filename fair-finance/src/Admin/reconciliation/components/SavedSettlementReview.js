import { useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	completenessBadge,
	sourcesLabel,
	typeLabel,
} from '../../settlements/format.js';
import {
	Button,
	CheckboxControl,
	Modal,
	Notice,
	SelectControl,
	Spinner,
	TextControl,
} from '@wordpress/components';
import AllocationProposal from './AllocationProposal.js';

export const stateLabel = ( state ) =>
	( {
		partial: __( 'Partial', 'fair-finance' ),
		full: __( 'Fully reconciled', 'fair-finance' ),
		needs_review: __( 'Needs review', 'fair-finance' ),
		released: __( 'Released', 'fair-finance' ),
	} )[ state ] || __( 'Not reconciled', 'fair-finance' );
const money = ( amount, currency ) =>
	amount === null || amount === undefined
		? __( 'Unknown', 'fair-finance' )
		: `${ amount } ${ currency || '' }`;

// Matches the main screen's bank entry filter.
export const DEFAULT_DESCRIPTION_FILTER = 'trf. stichting mollie payments';
const matchesDescription = ( entry, filter ) =>
	! filter ||
	( entry.description || '' ).toLowerCase().includes( filter.toLowerCase() );

function ReviewedEvidence( { entry } ) {
	let reviewed;
	try {
		reviewed = JSON.parse( entry.reviewed );
	} catch {
		return null;
	}
	const previous = reviewed.preview;
	if ( ! previous ) return null;
	return (
		<details>
			<summary>
				{ __(
					'Show the evidence reviewed for this decision',
					'fair-finance'
				) }
			</summary>
			<p>
				{ sprintf(
					/* translators: 1: bank entry ID, 2: exact amount and currency. */
					__( 'Bank entry #%1$d: %2$s', 'fair-finance' ),
					Number( previous.bank?.id || previous.decision?.entry_id ),
					money( previous.bank?.amount, previous.currency )
				) }
			</p>
			<p>
				{ sprintf(
					/* translators: %s: exact amount and currency. */
					__( 'Reviewed payout explanation: %s', 'fair-finance' ),
					money(
						previous.explanation.net,
						previous.settlement.currency
					)
				) }
			</p>
			<ul>
				{ previous.movements.map( ( row ) => (
					<li key={ `${ row.sources[ 0 ] }:${ row.identity_key }` }>
						{ row.external_id || row.description } —{ ' ' }
						{ money(
							row.settlement_amount,
							row.settlement_currency
						) }
					</li>
				) ) }
			</ul>
		</details>
	);
}

export function SavedSettlementSelector( { value, onChange } ) {
	const [ list, setList ] = useState( [] );
	const [ page, setPage ] = useState( 1 );
	const [ pages, setPages ] = useState( 1 );
	const [ error, setError ] = useState( null );
	useEffect( () => {
		let active = true;
		apiFetch( {
			path: `/fair-payments-connector/v1/settlements?per_page=20&page=${ page }`,
		} )
			.then( ( data ) => {
				if ( active ) {
					setList( data.items || [] );
					setPages( data.pages || 1 );
					setError( null );
				}
			} )
			.catch( ( err ) => {
				if ( active )
					setError(
						err.message ||
							__(
								'Saved settlements could not be loaded.',
								'fair-finance'
							)
					);
			} );
		return () => {
			active = false;
		};
	}, [ page ] );
	return (
		<div className="fair-finance-saved-selector">
			<SelectControl
				label={ __( 'Saved settlement', 'fair-finance' ) }
				value={ value }
				onChange={ onChange }
				options={ [
					{
						label: __(
							'Use the existing CSV and manual workflow',
							'fair-finance'
						),
						value: '',
					},
					...( value &&
					! list.some(
						( row ) => String( row.id ) === String( value )
					)
						? [
								{
									label: sprintf(
										/* translators: %d: saved settlement ID. */
										__( 'Settlement #%d', 'fair-finance' ),
										Number( value )
									),
									value,
								},
							]
						: [] ),
					...list.map( ( row ) => ( {
						label: `${ row.reference || row.provider_id || row.id } — ${ row.account?.label || '' }`,
						value: String( row.id ),
					} ) ),
				] }
			/>
			{ pages > 1 && (
				<div className="fair-finance-saved-actions">
					<Button
						variant="secondary"
						disabled={ page <= 1 }
						onClick={ () => setPage( page - 1 ) }
					>
						{ __( 'Previous settlements', 'fair-finance' ) }
					</Button>
					<Button
						variant="secondary"
						disabled={ page >= pages }
						onClick={ () => setPage( page + 1 ) }
					>
						{ __( 'Next settlements', 'fair-finance' ) }
					</Button>
				</div>
			) }
			{ error && (
				<Notice status="warning" isDismissible={ false }>
					{ error }
				</Notice>
			) }
		</div>
	);
}

export default function SavedSettlementReview( {
	settlementId,
	proposedEntryId = '',
} ) {
	const [ data, setData ] = useState( null );
	const [ candidates, setCandidates ] = useState( [] );
	const [ descriptionFilter, setDescriptionFilter ] = useState(
		DEFAULT_DESCRIPTION_FILTER
	);
	const [ proposalIgnored, setProposalIgnored ] = useState( false );
	const [ selection, setSelection ] = useState( {
		entry_id: '',
		currency: '',
		account_id: '',
	} );
	const [ phase, setPhase ] = useState( 'loading' );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ reviewed, setReviewed ] = useState( false );
	const [ adopt, setAdopt ] = useState( false );
	const [ budgets, setBudgets ] = useState( [] );
	const [ budgetId, setBudgetId ] = useState( 'auto' );
	const [ confirming, setConfirming ] = useState( null );
	const busy = useRef( false );
	const body = () => ( {
		...( selection.entry_id
			? { entry_id: Number( selection.entry_id ) }
			: {} ),
		...( selection.currency ? { currency: selection.currency } : {} ),
		...( selection.account_id
			? { account_id: Number( selection.account_id ) }
			: {} ),
	} );
	useEffect( () => {
		let active = true;
		setPhase( 'loading' );
		setReviewed( false );
		setError( null );
		setProposalIgnored( false );
		const open = ( proposal ) =>
			apiFetch( {
				path: `/fair-finance/v1/reconciliation/settlements/${ settlementId }/preview`,
				method: 'POST',
				...( proposal ? { data: proposal } : {} ),
			} );
		// A bank entry chosen on the main screen is only a proposal: an
		// existing association stays until the administrator releases it.
		const initial = proposedEntryId
			? open( { entry_id: Number( proposedEntryId ) } ).then(
					( result ) => {
						if (
							! result.decision ||
							String( result.decision.entry_id ) ===
								String( proposedEntryId )
						)
							return result;
						if ( active ) setProposalIgnored( true );
						return open();
					}
				)
			: open();
		Promise.all( [
			initial,
			apiFetch( {
				path: `/fair-finance/v1/reconciliation/settlements/${ settlementId }/candidates`,
			} ),
			apiFetch( { path: '/fair-finance/v1/budgets' } ),
		] )
			.then( ( [ preview, entries, budgetList ] ) => {
				if ( ! active ) return;
				setData( preview );
				setCandidates( entries );
				setBudgets( budgetList );
				setSelection( {
					entry_id: preview.bank?.id ? String( preview.bank.id ) : '',
					currency: preview.context?.currency || '',
					account_id: preview.context?.account_id
						? String( preview.context.account_id )
						: '',
				} );
				setReviewed( true );
				setPhase( 'ready' );
			} )
			.catch( ( err ) => {
				if ( active ) {
					setError(
						err.message ||
							__(
								'The settlement could not be opened.',
								'fair-finance'
							)
					);
					setPhase( 'ready' );
				}
			} );
		return () => {
			active = false;
		};
	}, [ settlementId, proposedEntryId ] );
	const change = ( field, value ) => {
		setSelection( ( current ) => ( { ...current, [ field ]: value } ) );
		setReviewed( false );
		setSuccess( null );
		setAdopt( false );
	};
	const preview = async () => {
		if ( busy.current ) return;
		busy.current = true;
		setPhase( 'previewing' );
		setError( null );
		setSuccess( null );
		try {
			const [ result, entries ] = await Promise.all( [
				apiFetch( {
					path: `/fair-finance/v1/reconciliation/settlements/${ settlementId }/preview`,
					method: 'POST',
					data: body(),
				} ),
				apiFetch( {
					path: `/fair-finance/v1/reconciliation/settlements/${ settlementId }/candidates`,
				} ),
			] );
			setData( result );
			setCandidates( entries );
			if ( result.context )
				setSelection( {
					entry_id: String( result.bank?.id || selection.entry_id ),
					currency: result.context.currency,
					account_id: String( result.context.account_id ),
				} );
			setReviewed( true );
			setAdopt( false );
		} catch ( err ) {
			setError(
				err.message ||
					__( 'Preview failed. Try again.', 'fair-finance' )
			);
			setReviewed( false );
		} finally {
			busy.current = false;
			setPhase( 'ready' );
		}
	};
	const confirm = async () => {
		if ( busy.current ) return;
		busy.current = true;
		setPhase( 'saving' );
		setError( null );
		try {
			const result = await apiFetch( {
				path: `/fair-finance/v1/reconciliation/settlements/${ settlementId }/confirm`,
				method: 'POST',
				data: {
					...body(),
					fingerprint: data.fingerprint,
					state: confirming,
					adopt_existing: adopt,
					...( confirming === 'full' &&
					data.allocation.status === 'proposed' &&
					budgetId !== 'auto'
						? { budget_id: budgetId ? Number( budgetId ) : null }
						: {} ),
				},
			} );
			setData( result );
			setConfirming( null );
			setAdopt( false );
			setSuccess(
				__( 'The reconciliation decision was saved.', 'fair-finance' )
			);
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'The decision could not be saved. Try again.',
						'fair-finance'
					)
			);
			if ( err.code === 'reconciliation_stale' ) setReviewed( false );
		} finally {
			busy.current = false;
			setPhase( 'ready' );
		}
	};
	if ( phase === 'loading' ) return <Spinner />;
	if ( ! data )
		return (
			<Notice status="error" isDismissible={ false }>
				{ error }
			</Notice>
		);
	const saving = phase === 'saving';
	const ready = phase === 'ready' && reviewed;
	const eligible =
		ready && data.can_partial && ( ! data.adoption_required || adopt );
	const name =
		data.settlement.reference ||
		data.settlement.provider_id ||
		settlementId;
	const allIssues = [ ...data.bank_issues, ...data.issues ];
	const splitProposed = data.allocation.status === 'proposed';
	// A full decision saved before supported splits were automatic.
	const repairable = splitProposed && data.decision?.state === 'full';
	const filteredCandidates = candidates.filter( ( entry ) =>
		matchesDescription( entry, descriptionFilter )
	);
	// The selection never depends on the filter: a selected entry outside it
	// stays listed so the reviewed proposal remains visible and valid.
	const hiddenSelection = [
		...candidates.filter(
			( entry ) =>
				String( entry.id ) === selection.entry_id &&
				! filteredCandidates.includes( entry )
		),
		...( data.bank &&
		! candidates.some(
			( entry ) => String( entry.id ) === String( data.bank.id )
		)
			? [ data.bank ]
			: [] ),
	];
	return (
		<div className="fair-finance-saved-review">
			<h2>
				{ sprintf(
					/* translators: %s: payout reference or settlement ID. */
					__( 'Reconcile settlement %s', 'fair-finance' ),
					name
				) }
			</h2>
			<p>
				{ __(
					'Review saved evidence and choose the bank entry. This review uses local records only.',
					'fair-finance'
				) }
			</p>
			<p>
				<strong>{ stateLabel( data.decision?.current_state ) }</strong>
			</p>
			{ success && (
				<Notice status="success" isDismissible={ false }>
					{ success }
				</Notice>
			) }
			{ error && ! confirming && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<dl className="fair-finance-saved-facts">
				<div>
					<dt>{ __( 'Payout account', 'fair-finance' ) }</dt>
					<dd>
						{ data.account?.label }{ ' ' }
						{ data.account?.organization_id }
					</dd>
				</div>
				<div>
					<dt>{ __( 'Provider payout', 'fair-finance' ) }</dt>
					<dd>
						{ money(
							data.settlement.amount,
							data.settlement.currency
						) }
					</dd>
				</div>
				<div>
					<dt>
						{ __( 'Supported payout explanation', 'fair-finance' ) }
					</dt>
					<dd>
						{ money(
							data.explanation.net,
							data.settlement.currency
						) }
					</dd>
				</div>
				<div>
					<dt>
						{ __( 'Difference from bank entry', 'fair-finance' ) }
					</dt>
					<dd>
						{ money( data.difference, data.settlement.currency ) }
					</dd>
				</div>
				<div>
					<dt>{ __( 'Import completeness', 'fair-finance' ) }</dt>
					<dd>
						{
							completenessBadge( data.settlement.completeness )
								.label
						}
					</dd>
				</div>
			</dl>
			<p>
				{ sprintf(
					/* translators: 1: last provider refresh time in UTC, 2: last CSV import time in UTC, or Never. */
					__(
						'Last provider refresh (UTC): %1$s · Last CSV import (UTC): %2$s',
						'fair-finance'
					),
					data.settlement.last_refreshed_at ||
						__( 'Never', 'fair-finance' ),
					data.settlement.last_csv_import_at ||
						__( 'Never', 'fair-finance' )
				) }
			</p>
			{ Object.entries( data.revisions ).map(
				( [ source, revision ] ) => (
					<p key={ source }>
						{ sprintf(
							/* translators: 1: source name, 2: revision ID, 3: saved time in UTC. */
							__(
								'Source: %1$s · Revision: %2$d · Saved (UTC): %3$s',
								'fair-finance'
							),
							source,
							Number( revision.id ),
							revision.published_at ||
								__( 'Unknown', 'fair-finance' )
						) }
					</p>
				)
			) }
			{ proposalIgnored && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: 1: bank entry ID selected on the main screen, 2: bank entry ID already associated with this settlement. */
						__(
							'Bank entry #%1$d was not applied: this settlement is already associated with bank entry #%2$d. Release that association before choosing a different entry.',
							'fair-finance'
						),
						Number( proposedEntryId ),
						Number( data.decision?.entry_id )
					) }
				</Notice>
			) }
			{ ! data.revisions.api && (
				<p>
					{ __(
						'For a CSV-only settlement, full reconciliation relies on the supported movements matching the selected bank entry exactly.',
						'fair-finance'
					) }
				</p>
			) }
			<p>
				<a
					href={ `admin.php?page=fair-finance-settlements&settlement=${ settlementId }` }
				>
					{ __( 'Saved settlement details', 'fair-finance' ) }
				</a>
			</p>
			<h3>{ __( 'Bank candidates', 'fair-finance' ) }</h3>
			{ candidates.length > 1 &&
				candidates[ 0 ].score === candidates[ 1 ].score && (
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Several bank entries have equally strong evidence. Review their references and account context before selecting one.',
							'fair-finance'
						) }
					</Notice>
				) }
			<p>
				{ __(
					'Suggestions are ranked by reference, confirmed account and currency, exact amount, and date. Select the entry yourself; matching amounts alone do not establish currency or account.',
					'fair-finance'
				) }
			</p>
			<TextControl
				label={ __( 'Filter by description', 'fair-finance' ) }
				value={ descriptionFilter }
				onChange={ setDescriptionFilter }
				placeholder={ __( 'Type to filter…', 'fair-finance' ) }
				help={ sprintf(
					/* translators: 1: number of bank candidates matching the filter, 2: number of all bank candidates. */
					__(
						'Showing %1$d of %2$d bank candidates.',
						'fair-finance'
					),
					filteredCandidates.length,
					candidates.length
				) }
			/>
			{ descriptionFilter && (
				<Button
					variant="tertiary"
					onClick={ () => setDescriptionFilter( '' ) }
				>
					{ __( 'Show all candidates', 'fair-finance' ) }
				</Button>
			) }
			{ filteredCandidates.length === 0 && (
				<p>
					{ candidates.length
						? __(
								'No bank candidates match this filter. Change or clear the filter to see all candidates.',
								'fair-finance'
							)
						: __(
								'There are no eligible bank income entries.',
								'fair-finance'
							) }
				</p>
			) }
			<SelectControl
				label={ __( 'Bank entry', 'fair-finance' ) }
				value={ selection.entry_id }
				disabled={ phase !== 'ready' || Boolean( data.decision ) }
				help={
					data.decision
						? __(
								'Release this bank association before choosing a different entry.',
								'fair-finance'
							)
						: undefined
				}
				onChange={ ( value ) => change( 'entry_id', value ) }
				options={ [
					{
						label: __( 'Select a bank entry', 'fair-finance' ),
						value: '',
					},
					...hiddenSelection,
					...filteredCandidates,
				].map( ( entry ) =>
					entry.value !== undefined
						? entry
						: {
								value: String( entry.id ),
								label: `#${ entry.id } · ${ entry.entry_date } · ${ entry.amount } · ${ entry.description || '' }`,
							}
				) }
			/>
			{ candidates
				.filter(
					( entry ) => String( entry.id ) === selection.entry_id
				)
				.map( ( entry ) => (
					<div key={ entry.id }>
						<ul>
							{ entry.reasons.map( ( reason ) => (
								<li key={ reason }>{ reason }</li>
							) ) }
						</ul>
						{ entry.context_mismatch && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'This entry has conflicting confirmed account or currency context.',
									'fair-finance'
								) }
							</Notice>
						) }
					</div>
				) ) }
			{ data.context && (
				<p>
					{ sprintf(
						/* translators: 1: administrator user ID, 2: confirmation time in UTC. */
						__(
							'Bank context confirmed by administrator #%1$d on %2$s (UTC).',
							'fair-finance'
						),
						Number( data.context.actor_id ),
						data.context.confirmed_at
					) }
				</p>
			) }
			<TextControl
				label={ __( 'Bank entry currency', 'fair-finance' ) }
				help={ __(
					'Enter the currency confirmed from your bank records, for example EUR.',
					'fair-finance'
				) }
				value={ selection.currency }
				disabled={
					phase !== 'ready' || Boolean( reviewed && data.context )
				}
				onChange={ ( value ) =>
					change( 'currency', value.toUpperCase() )
				}
			/>
			<CheckboxControl
				label={ sprintf(
					/* translators: %s: provider account label. */
					__(
						'I confirm this bank entry is the payout from account %s.',
						'fair-finance'
					),
					data.account?.label || ''
				) }
				checked={ selection.account_id === String( data.account?.id ) }
				disabled={
					phase !== 'ready' || Boolean( reviewed && data.context )
				}
				onChange={ ( checked ) =>
					change(
						'account_id',
						checked ? String( data.account.id ) : ''
					)
				}
			/>
			<Button
				variant="secondary"
				onClick={ preview }
				disabled={ phase !== 'ready' }
				isBusy={ phase === 'previewing' }
			>
				{ __( 'Refresh local preview', 'fair-finance' ) }
			</Button>
			{ ! reviewed && (
				<p>
					{ __(
						'Refresh the preview after changing your selection, then review the result before confirming.',
						'fair-finance'
					) }
				</p>
			) }
			{ allIssues.length > 0 && (
				<Notice status="warning" isDismissible={ false }>
					<ul>
						{ [ ...new Set( allIssues ) ].map( ( issue ) => (
							<li key={ issue }>{ issue }</li>
						) ) }
					</ul>
				</Notice>
			) }
			<h3>
				{ __( 'Movements and local transactions', 'fair-finance' ) }
			</h3>
			<div className="fair-finance-saved-table">
				<table className="widefat striped">
					<thead>
						<tr>
							<th>{ __( 'Movement', 'fair-finance' ) }</th>
							<th>{ __( 'Original amount', 'fair-finance' ) }</th>
							<th>
								{ __( 'Settlement amount', 'fair-finance' ) }
							</th>
							<th>
								{ __( 'Local transactions', 'fair-finance' ) }
							</th>
						</tr>
					</thead>
					<tbody>
						{ data.movements.map( ( row ) => (
							<tr
								key={ `${ row.sources[ 0 ] }:${ row.identity_key }` }
							>
								<td
									data-label={ __(
										'Movement',
										'fair-finance'
									) }
								>
									{ typeLabel( row.type ) }
									<br />
									{ row.external_id || row.description }
									<br />
									{ row.payment_reference }
									<br />
									{ sourcesLabel( row.sources ) }
								</td>
								<td
									data-label={ __(
										'Original amount',
										'fair-finance'
									) }
								>
									{ money( row.amount, row.currency ) }
								</td>
								<td
									data-label={ __(
										'Settlement amount',
										'fair-finance'
									) }
								>
									{ money(
										row.settlement_amount,
										row.settlement_currency
									) }
								</td>
								<td
									data-label={ __(
										'Local transactions',
										'fair-finance'
									) }
								>
									{ row.transactions.length
										? row.transactions.map(
												( transaction ) => (
													<p key={ transaction.id }>
														<a
															href={ `admin.php?page=fair-payments-connector-transaction&id=${ transaction.id }` }
														>
															#{ transaction.id }
														</a>{ ' ' }
														{ money(
															transaction.amount,
															transaction.currency
														) }
													</p>
												)
											)
										: row.payment_reference
											? __(
													'Not imported yet',
													'fair-finance'
												)
											: __(
													'Settlement-level evidence',
													'fair-finance'
												) }
									{ row.conflict && (
										<strong>
											{ __(
												'Conflicting source values',
												'fair-finance'
											) }
										</strong>
									) }
								</td>
							</tr>
						) ) }
					</tbody>
				</table>
			</div>
			<h3>
				{ __( 'Allocations and existing matches', 'fair-finance' ) }
			</h3>
			<AllocationProposal
				allocation={ data.allocation }
				budgets={ budgets }
				currency={ data.settlement.currency }
				reviewedBudget={ budgetId === 'auto' ? undefined : budgetId }
			/>
			{ data.allocation.status === 'unsupported' && data.can_full && (
				<p>
					{ __(
						'The reconciliation evidence is complete, so the bank association can be confirmed. The allocation still needs review: no split is created.',
						'fair-finance'
					) }
				</p>
			) }
			{ splitProposed && (
				<SelectControl
					label={ __( 'Budget for new allocations', 'fair-finance' ) }
					value={ budgetId }
					onChange={ setBudgetId }
					options={ [
						{
							label: __(
								'Use each transaction’s proposed budget',
								'fair-finance'
							),
							value: 'auto',
						},
						{
							label: __( 'No budget', 'fair-finance' ),
							value: '',
						},
						...budgets.map( ( budget ) => ( {
							label: budget.name,
							value: String( budget.id ),
						} ) ),
					] }
				/>
			) }
			{ data.links?.length > 0 && (
				<ul>
					{ data.links.map( ( link ) => (
						<li
							key={ `${ link.entry_id }:${ link.transaction_id }` }
						>
							{ sprintf(
								/* translators: 1: financial entry ID, 2: local transaction ID. */
								__(
									'Existing match: bank entry #%1$d and transaction #%2$d.',
									'fair-finance'
								),
								Number( link.entry_id ),
								Number( link.transaction_id )
							) }
						</li>
					) ) }
				</ul>
			) }
			{ data.bank_rows?.length > 0 && (
				<ul>
					{ data.bank_rows.map( ( entry ) => (
						<li key={ entry.id }>
							{ sprintf(
								/* translators: 1: financial entry ID, 2: exact amount, 3: budget ID or an em dash. */
								__(
									'Entry #%1$d: %2$s · Budget #%3$s',
									'fair-finance'
								),
								Number( entry.id ),
								entry.amount,
								entry.budget_id || '—'
							) }
						</li>
					) ) }
				</ul>
			) }
			{ data.adoption_required && (
				<CheckboxControl
					label={ __(
						'Adopt the compatible existing payment matches shown in this preview.',
						'fair-finance'
					) }
					checked={ adopt }
					onChange={ setAdopt }
					disabled={ ! ready }
				/>
			) }
			{ repairable && (
				<div className="fair-finance-saved-repair">
					<p>
						{ __(
							'This settlement is fully reconciled, but its bank entry was not split. Applying the split keeps the bank association and records it in the confirmation history.',
							'fair-finance'
						) }
					</p>
					<Button
						variant="primary"
						disabled={ ! ready || ! data.can_full }
						onClick={ () => {
							setError( null );
							setConfirming( 'full' );
						} }
					>
						{ __( 'Apply the proposed split', 'fair-finance' ) }
					</Button>
				</div>
			) }
			<div className="fair-finance-saved-actions">
				<Button
					variant="secondary"
					disabled={ ! eligible }
					onClick={ () => {
						setError( null );
						setConfirming( 'partial' );
					} }
				>
					{ __( 'Save as Partial', 'fair-finance' ) }
				</Button>
				<Button
					variant="primary"
					disabled={ ! eligible || ! data.can_full }
					onClick={ () => {
						setError( null );
						setConfirming( 'full' );
					} }
				>
					{ __( 'Confirm Fully reconciled', 'fair-finance' ) }
				</Button>
				{ data.decision && (
					<Button
						variant="tertiary"
						disabled={ ! ready }
						onClick={ () => {
							setError( null );
							setConfirming( 'released' );
						} }
					>
						{ __( 'Release bank association', 'fair-finance' ) }
					</Button>
				) }
			</div>
			{ data.history.length > 0 && (
				<>
					<h3>{ __( 'Confirmation history', 'fair-finance' ) }</h3>
					<ul>
						{ data.history.map( ( entry ) => (
							<li key={ entry.id }>
								{ sprintf(
									/* translators: 1: decision state, 2: administrator user ID, 3: confirmation time in UTC. */
									__(
										'%1$s · Administrator #%2$d · %3$s (UTC)',
										'fair-finance'
									),
									stateLabel( entry.state ),
									Number( entry.actor_id ),
									entry.confirmed_at
								) }
								<ReviewedEvidence entry={ entry } />
							</li>
						) ) }
					</ul>
				</>
			) }
			{ confirming && (
				<Modal
					title={ sprintf(
						/* translators: %s: payout reference or settlement ID. */
						__( 'Save reconciliation — %s', 'fair-finance' ),
						name
					) }
					onRequestClose={ () => {
						if ( ! saving ) {
							setConfirming( null );
							setError( null );
						}
					} }
					isDismissible={ ! saving }
					shouldCloseOnEsc={ ! saving }
					shouldCloseOnClickOutside={ ! saving }
				>
					<p>
						{ sprintf(
							/* translators: 1: decision state, 2: payout reference, 3: bank entry ID. */
							__(
								'Save %1$s for settlement %2$s and bank entry #%3$d?',
								'fair-finance'
							),
							stateLabel( confirming ),
							name,
							Number(
								selection.entry_id ||
									data.bank?.id ||
									data.decision?.entry_id
							)
						) }
					</p>
					<p>
						{ __(
							'This saves local evidence only and does not move or refund money. You can release the bank association later; confirmation history is retained.',
							'fair-finance'
						) }
					</p>
					<p>
						{ confirming === 'full' && splitProposed
							? __(
									'The bank entry is also split into the proposed allocations shown in the review. Existing allocations are never replaced.',
									'fair-finance'
								)
							: __(
									'Existing allocations are not changed.',
									'fair-finance'
								) }
					</p>
					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }
					{ ! reviewed && (
						<p>
							{ __(
								'Cancel and refresh the preview before confirming again.',
								'fair-finance'
							) }
						</p>
					) }
					<div className="fair-finance-saved-actions">
						<Button
							variant="secondary"
							disabled={ saving }
							onClick={ () => {
								setConfirming( null );
								setError( null );
							} }
						>
							{ __( 'Cancel', 'fair-finance' ) }
						</Button>
						<Button
							variant="primary"
							disabled={ saving || ! reviewed }
							isBusy={ saving }
							onClick={ confirm }
						>
							{ __(
								'Save reconciliation decision',
								'fair-finance'
							) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
