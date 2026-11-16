import { useRef, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { Button, Modal, Notice } from '@wordpress/components';
import {
	applyRecalculation,
	previewRecalculation,
} from '../../settlements/settlements-api.js';

const actionLabel = ( change ) => {
	if ( change.action === 'add' ) return __( 'Added', 'fair-finance' );
	if ( change.action === 'remove' ) return __( 'Removed', 'fair-finance' );
	if ( change.transferred_from && change.action === 'update' )
		return __(
			'Replaced by the settlement adjustment, keeping its categorization',
			'fair-finance'
		);
	if ( change.action === 'update' )
		return __( 'Amount corrected', 'fair-finance' );
	return __( 'Unchanged', 'fair-finance' );
};

/**
 * Explicit, previewed recalculation of an existing settlement split.
 *
 * Shows every allocation's current and proposed amount next to the event,
 * budget and tag it keeps, and applies nothing until the administrator
 * confirms the reviewed preview.
 *
 * @param {Object}   props
 * @param {number}   props.settlementId Settlement ID.
 * @param {string}   props.name         Payout reference or settlement ID.
 * @param {Array}    props.budgets      Budgets, for names.
 * @param {Function} props.onApplied    Receives the fresh settlement preview.
 */
export default function SplitRecalculation( {
	settlementId,
	name,
	budgets = [],
	onApplied,
} ) {
	const [ review, setReview ] = useState( null );
	const [ phase, setPhase ] = useState( 'idle' );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ confirming, setConfirming ] = useState( false );
	const busy = useRef( false );
	const saving = phase === 'saving';
	const currency = review?.currency || '';
	const money = ( amount ) =>
		amount === null || amount === undefined
			? '—'
			: `${ amount } ${ currency }`;
	const budgetName = ( id ) => {
		if ( ! id ) return __( 'No budget', 'fair-finance' );
		const budget = budgets.find(
			( item ) => String( item.id ) === String( id )
		);
		return budget
			? budget.name
			: sprintf(
					/* translators: %d: budget ID. */
					__( 'Budget #%d', 'fair-finance' ),
					Number( id )
				);
	};
	const load = async () => {
		if ( busy.current ) return;
		busy.current = true;
		setPhase( 'previewing' );
		setError( null );
		setSuccess( null );
		try {
			setReview( await previewRecalculation( settlementId ) );
		} catch ( err ) {
			setReview( null );
			setError(
				err.message ||
					__(
						'The recalculation could not be previewed. Try again.',
						'fair-finance'
					)
			);
		} finally {
			busy.current = false;
			setPhase( 'idle' );
		}
	};
	const apply = async () => {
		if ( busy.current ) return;
		busy.current = true;
		setPhase( 'saving' );
		setError( null );
		try {
			const result = await applyRecalculation(
				settlementId,
				review.fingerprint
			);
			setConfirming( false );
			setReview( null );
			setSuccess(
				__(
					'The split was recalculated. Allocation tags, events and budgets were kept.',
					'fair-finance'
				)
			);
			onApplied?.( result.preview );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'The split could not be recalculated. Nothing was changed.',
						'fair-finance'
					)
			);
			// A stale review must be previewed again before applying.
			if ( err.code === 'reconciliation_stale' ) {
				setConfirming( false );
				setReview( null );
			}
		} finally {
			busy.current = false;
			setPhase( 'idle' );
		}
	};
	const changed = ( review?.changes || [] ).filter(
		( change ) => change.action !== 'keep'
	);
	const removed = changed.filter( ( change ) => change.action === 'remove' );
	const added = changed.filter( ( change ) => change.action === 'add' );
	return (
		<div className="fair-finance-recalculation">
			<h3>{ __( 'Recalculate the existing split', 'fair-finance' ) }</h3>
			<p>
				{ __(
					'If payment fees were recorded after this split was created, preview a recalculation from the current evidence. Nothing changes until you confirm.',
					'fair-finance'
				) }
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
			<Button
				variant="secondary"
				onClick={ load }
				disabled={ phase !== 'idle' }
				isBusy={ phase === 'previewing' }
			>
				{ __( 'Preview recalculation', 'fair-finance' ) }
			</Button>
			{ review && (
				<>
					{ review.explanation && (
						<Notice
							status={
								review.status === 'blocked' ? 'warning' : 'info'
							}
							isDismissible={ false }
						>
							{ review.explanation }
						</Notice>
					) }
					{ review.status === 'unchanged' && (
						<Notice status="info" isDismissible={ false }>
							{ __(
								'The split already matches the current evidence. Nothing needs to change.',
								'fair-finance'
							) }
						</Notice>
					) }
					{ review.reasons.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ __(
									'This split cannot be recalculated automatically:',
									'fair-finance'
								) }
							</p>
							<ul>
								{ review.reasons.map( ( reason ) => (
									<li key={ reason }>{ reason }</li>
								) ) }
							</ul>
						</Notice>
					) }
					{ review.recovered?.length > 0 && (
						<Notice status="info" isDismissible={ false }>
							<p>
								{ __(
									'An earlier split save gave these allocations new IDs. Each is identified by its unchanged amount and description, and keeps its current tag, event and budget:',
									'fair-finance'
								) }
							</p>
							<ul>
								{ review.recovered.map( ( item ) => (
									<li key={ item.id }>
										{ sprintf(
											/* translators: 1: current allocation ID, 2: allocation ID recorded by reconciliation. */
											__(
												'Allocation #%1$d was created by reconciliation as #%2$d.',
												'fair-finance'
											),
											Number( item.id ),
											Number( item.history_id )
										) }
									</li>
								) ) }
							</ul>
						</Notice>
					) }
					{ review.warnings.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							<p>
								{ __(
									'Manual edits affected by this recalculation:',
									'fair-finance'
								) }
							</p>
							<ul>
								{ review.warnings.map( ( warning ) => (
									<li key={ warning }>{ warning }</li>
								) ) }
							</ul>
						</Notice>
					) }
					{ review.changes.length > 0 && (
						<div className="fair-finance-saved-table">
							<table className="widefat striped">
								<thead>
									<tr>
										<th>
											{ __(
												'Allocation',
												'fair-finance'
											) }
										</th>
										<th>
											{ __(
												'Current amount',
												'fair-finance'
											) }
										</th>
										<th>
											{ __(
												'Proposed amount',
												'fair-finance'
											) }
										</th>
										<th>
											{ __(
												'Kept categorization',
												'fair-finance'
											) }
										</th>
										<th>
											{ __( 'Change', 'fair-finance' ) }
										</th>
									</tr>
								</thead>
								<tbody>
									{ review.changes.map( ( change ) => (
										<tr
											key={
												change.id ||
												`new:${ change.movement_key }`
											}
										>
											<td
												data-label={ __(
													'Allocation',
													'fair-finance'
												) }
											>
												{ change.id
													? sprintf(
															/* translators: %d: allocation ID. */
															__(
																'Allocation #%d',
																'fair-finance'
															),
															Number( change.id )
														)
													: __(
															'New allocation',
															'fair-finance'
														) }
												{ change.recovered_from && (
													<>
														{ ' ' }
														{ sprintf(
															/* translators: %d: allocation ID recorded by reconciliation. */
															__(
																'(recorded as #%d)',
																'fair-finance'
															),
															Number(
																change.recovered_from
															)
														) }
													</>
												) }
												<br />
												{ change.new_description
													? sprintf(
															/* translators: 1: current description, 2: proposed description. */
															__(
																'%1$s → %2$s',
																'fair-finance'
															),
															change.description,
															change.new_description
														)
													: change.description ||
														__(
															'No description',
															'fair-finance'
														) }
											</td>
											<td
												data-label={ __(
													'Current amount',
													'fair-finance'
												) }
												className="fair-finance-amount"
											>
												{ money(
													change.current_amount
												) }
											</td>
											<td
												data-label={ __(
													'Proposed amount',
													'fair-finance'
												) }
												className="fair-finance-amount"
											>
												{ change.action === 'remove'
													? __(
															'Removed',
															'fair-finance'
														)
													: money(
															change.proposed_amount
														) }
											</td>
											<td
												data-label={ __(
													'Kept categorization',
													'fair-finance'
												) }
											>
												{ sprintf(
													/* translators: %s: allocation tag, or Untagged. */
													__(
														'Tag: %s',
														'fair-finance'
													),
													change.tag ||
														__(
															'Untagged',
															'fair-finance'
														)
												) }
												<br />
												{ sprintf(
													/* translators: %s: budget name, or No budget. */
													__(
														'Budget: %s',
														'fair-finance'
													),
													budgetName(
														change.budget_id
													)
												) }
												<br />
												{ change.event_url ? (
													<a
														href={
															change.event_url
														}
													>
														{ change.event_url }
													</a>
												) : (
													__(
														'No event link',
														'fair-finance'
													)
												) }
											</td>
											<td
												data-label={ __(
													'Change',
													'fair-finance'
												) }
											>
												{ actionLabel( change ) }
											</td>
										</tr>
									) ) }
								</tbody>
							</table>
						</div>
					) }
					{ review.status === 'proposed' && (
						<div className="fair-finance-saved-actions">
							<Button
								variant="primary"
								disabled={ phase !== 'idle' }
								onClick={ () => {
									setError( null );
									setConfirming( true );
								} }
							>
								{ __( 'Apply recalculation', 'fair-finance' ) }
							</Button>
						</div>
					) }
				</>
			) }
			{ confirming && review && (
				<Modal
					title={ sprintf(
						/* translators: %s: payout reference or settlement ID. */
						__( 'Recalculate split — %s', 'fair-finance' ),
						name
					) }
					onRequestClose={ () => {
						if ( ! saving ) {
							setConfirming( false );
							setError( null );
						}
					} }
					isDismissible={ ! saving }
					shouldCloseOnEsc={ ! saving }
					shouldCloseOnClickOutside={ ! saving }
					style={ { maxWidth: '560px', width: '100%' } }
				>
					<p style={ { overflowWrap: 'anywhere' } }>
						{ sprintf(
							/* translators: 1: number of changed allocations, 2: bank entry ID. */
							_n(
								'Apply the previewed change to %1$d allocation of bank entry #%2$d?',
								'Apply the previewed changes to %1$d allocations of bank entry #%2$d?',
								changed.length,
								'fair-finance'
							),
							changed.length,
							Number( review.entry_id )
						) }
					</p>
					{ added.length > 0 && (
						<p>
							{ sprintf(
								/* translators: %d: number of allocations added. */
								_n(
									'%d untagged allocation is added.',
									'%d untagged allocations are added.',
									added.length,
									'fair-finance'
								),
								added.length
							) }
						</p>
					) }
					{ removed.length > 0 && (
						<p>
							{ sprintf(
								/* translators: %d: number of allocations removed. */
								_n(
									'%d generated allocation is removed.',
									'%d generated allocations are removed.',
									removed.length,
									'fair-finance'
								),
								removed.length
							) }
						</p>
					) }
					<p>
						{ __(
							'Each allocation keeps its tag (including untagged ones), event, budget, description and payment links. This changes local records only and does not move or refund money. The change is recorded in the confirmation history.',
							'fair-finance'
						) }
					</p>
					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }
					<div className="fair-finance-saved-actions">
						<Button
							variant="secondary"
							disabled={ saving }
							onClick={ () => {
								setConfirming( false );
								setError( null );
							} }
						>
							{ __( 'Cancel', 'fair-finance' ) }
						</Button>
						<Button
							variant="primary"
							disabled={ saving }
							isBusy={ saving }
							onClick={ apply }
						>
							{ __( 'Recalculate split', 'fair-finance' ) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
