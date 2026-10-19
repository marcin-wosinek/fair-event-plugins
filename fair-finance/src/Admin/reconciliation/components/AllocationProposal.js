import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

const STATUS_NOTICE = {
	proposed: 'info',
	single: 'info',
	allocated: 'info',
	unsupported: 'warning',
};

/**
 * The allocation a reconciliation creates, as planned by the server.
 *
 * Shared by the saved-settlement review and the bank-transfer screen, so
 * both show the same amounts, links and budgets before confirming.
 *
 * @param {Object}           props
 * @param {Object}           props.allocation     Proposal from the server.
 * @param {Array}            props.budgets        Budgets, for names.
 * @param {string}           props.currency       Currency of the amounts.
 * @param {string|undefined} props.reviewedBudget Budget ID applied to every
 *                                                row, '' for none, or
 *                                                undefined for each row's own.
 */
export default function AllocationProposal( {
	allocation,
	budgets = [],
	currency = '',
	reviewedBudget,
} ) {
	if ( ! allocation?.status ) return null;
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
	const showRows =
		allocation.rows?.length > 0 &&
		[ 'proposed', 'single' ].includes( allocation.status );
	return (
		<div className="fair-finance-allocation-proposal">
			<Notice
				status={ STATUS_NOTICE[ allocation.status ] || 'info' }
				isDismissible={ false }
			>
				{ allocation.reason }
			</Notice>
			{ showRows && (
				<div className="fair-finance-saved-table">
					<table className="widefat striped">
						<thead>
							<tr>
								<th>{ __( 'Allocation', 'fair-finance' ) }</th>
								<th>{ __( 'Amount', 'fair-finance' ) }</th>
								<th>{ __( 'Event', 'fair-finance' ) }</th>
								<th>{ __( 'Budget', 'fair-finance' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ allocation.rows.map( ( row, index ) => (
								<tr key={ row.movement_key || index }>
									<td
										data-label={ __(
											'Allocation',
											'fair-finance'
										) }
									>
										{ row.description ||
											__(
												'No description',
												'fair-finance'
											) }
										{ row.kind === 'settlement' && (
											<>
												<br />
												<small>
													{ __(
														'Settlement-level fee or adjustment',
														'fair-finance'
													) }
												</small>
											</>
										) }
									</td>
									<td
										data-label={ __(
											'Amount',
											'fair-finance'
										) }
										className="fair-finance-amount"
									>
										{ `${ row.amount } ${ currency }` }
									</td>
									<td
										data-label={ __(
											'Event',
											'fair-finance'
										) }
									>
										{ row.event_url ? (
											<a href={ row.event_url }>
												{ row.event_url }
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
											'Budget',
											'fair-finance'
										) }
									>
										{ budgetName(
											reviewedBudget === undefined
												? row.budget_id
												: reviewedBudget
										) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
				</div>
			) }
		</div>
	);
}

// What a confirmed match did to the bank entry's allocation.
export const matchOutcome = (
	allocation,
	matched = __(
		'Transactions matched successfully.',
		'fair-payments-connector'
	)
) => {
	const created = allocation?.allocation_ids?.length || 0;
	if ( created > 0 ) {
		return sprintf(
			/* translators: %d: number of allocations created. */
			__(
				'Transactions matched and the entry was split into %d allocations.',
				'fair-finance'
			),
			created
		);
	}
	if ( allocation?.status === 'unsupported' ) {
		return sprintf(
			/* translators: %s: why no split was created. */
			__(
				'Transactions matched. The allocation still needs review: %s',
				'fair-finance'
			),
			allocation.reason
		);
	}
	return matched;
};
