/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	SelectControl,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	completenessBadge,
	formatDatetime,
	formatMoney,
	settlementName,
	settlementUrl,
	sourcesLabel,
} from '../format.js';

/**
 * Small status label.
 *
 * @param {Object} props
 * @param {string} props.tone     `good`, `neutral` or `warning`.
 * @param {string} props.children Label.
 * @return {JSX.Element} Badge.
 */
export const Badge = ( { tone, children } ) => (
	<span className={ `fair-finance-settlements-badge is-${ tone }` }>
		{ children }
	</span>
);

/**
 * The saved settlements, most recent payout first.
 *
 * @param {Object}   props
 * @param {Object}   props.result          `{ items, total, pages, page }`.
 * @param {Object[]} props.accounts        Accounts to filter by.
 * @param {number}   props.accountId       Selected account, or 0 for all.
 * @param {Function} props.onAccountChange Called with the chosen account ID.
 * @param {Function} props.onPageChange    Called with the page to show.
 * @return {JSX.Element} List.
 */
export default function SettlementList( {
	result,
	accounts,
	accountId,
	onAccountChange,
	onPageChange,
} ) {
	const { items, total, pages, page } = result;

	return (
		<>
			{ accounts.length > 1 && (
				<div className="fair-finance-settlements-filter">
					<SelectControl
						__next40pxDefaultSize
						label={ __( 'Mollie account', 'fair-finance' ) }
						value={ String( accountId ) }
						options={ [
							{
								value: '0',
								label: __( 'All accounts', 'fair-finance' ),
							},
							...accounts.map( ( account ) => ( {
								value: String( account.id ),
								label: account.label,
							} ) ),
						] }
						onChange={ ( value ) =>
							onAccountChange( Number( value ) )
						}
					/>
				</div>
			) }

			{ items.length === 0 ? (
				<p className="fair-finance-settlements-empty">
					{ __(
						'No settlements are saved yet. Load them from Mollie or import a settlement CSV.',
						'fair-finance'
					) }
				</p>
			) : (
				<table className="wp-list-table widefat striped fair-finance-settlements-table">
					<thead>
						<tr>
							<th>{ __( 'Settlement', 'fair-finance' ) }</th>
							<th>{ __( 'Account', 'fair-finance' ) }</th>
							<th>{ __( 'Paid out', 'fair-finance' ) }</th>
							<th>{ __( 'Payout', 'fair-finance' ) }</th>
							<th>{ __( 'Mollie status', 'fair-finance' ) }</th>
							<th>{ __( 'Source', 'fair-finance' ) }</th>
							<th>{ __( 'Data', 'fair-finance' ) }</th>
						</tr>
					</thead>
					<tbody>
						{ items.map( ( item ) => {
							const badge = completenessBadge(
								item.completeness
							);
							return (
								<tr key={ item.id }>
									<td
										data-label={ __(
											'Settlement',
											'fair-finance'
										) }
									>
										<a href={ settlementUrl( item.id ) }>
											<strong>
												{ settlementName( item ) }
											</strong>
										</a>
									</td>
									<td
										data-label={ __(
											'Account',
											'fair-finance'
										) }
									>
										{ item.account?.label }
										{ item.account &&
											! item.account.verified && (
												<>
													{ ' ' }
													<Badge tone="neutral">
														{ __(
															'Not confirmed',
															'fair-finance'
														) }
													</Badge>
												</>
											) }
									</td>
									<td
										data-label={ __(
											'Paid out',
											'fair-finance'
										) }
									>
										{ formatDatetime(
											item.settled_at,
											__( 'Unknown', 'fair-finance' )
										) }
									</td>
									<td
										data-label={ __(
											'Payout',
											'fair-finance'
										) }
									>
										{ formatMoney(
											item.amount,
											item.currency
										) }
									</td>
									<td
										data-label={ __(
											'Mollie status',
											'fair-finance'
										) }
									>
										{ item.status ||
											__( 'Unknown', 'fair-finance' ) }
									</td>
									<td
										data-label={ __(
											'Source',
											'fair-finance'
										) }
									>
										{ sourcesLabel( item.sources ) }
									</td>
									<td
										data-label={ __(
											'Data',
											'fair-finance'
										) }
									>
										<Badge tone={ badge.tone }>
											{ badge.label }
										</Badge>
										{ item.discrepancy_count > 0 && (
											<>
												{ ' ' }
												<Badge tone="warning">
													{ sprintf(
														/* translators: %d: number of points to review */
														_n(
															'%d point to review',
															'%d points to review',
															item.discrepancy_count,
															'fair-finance'
														),
														item.discrepancy_count
													) }
												</Badge>
											</>
										) }
										{ item.last_failure && (
											<>
												{ ' ' }
												<Badge tone="warning">
													{ __(
														'Last load failed',
														'fair-finance'
													) }
												</Badge>
											</>
										) }
									</td>
								</tr>
							);
						} ) }
					</tbody>
				</table>
			) }

			{ pages > 1 && (
				<HStack
					justify="space-between"
					className="fair-finance-settlements-pagination"
					wrap
				>
					<span>
						{ sprintf(
							/* translators: 1: current page, 2: number of pages, 3: number of settlements */
							_n(
								'Page %1$d of %2$d (%3$d settlement)',
								'Page %1$d of %2$d (%3$d settlements)',
								total,
								'fair-finance'
							),
							page,
							pages,
							total
						) }
					</span>
					<HStack justify="flex-end" expanded={ false }>
						<Button
							variant="secondary"
							disabled={ page <= 1 }
							onClick={ () => onPageChange( page - 1 ) }
						>
							{ __( 'Previous', 'fair-finance' ) }
						</Button>
						<Button
							variant="secondary"
							disabled={ page >= pages }
							onClick={ () => onPageChange( page + 1 ) }
						>
							{ __( 'Next', 'fair-finance' ) }
						</Button>
					</HStack>
				</HStack>
			) }
		</>
	);
}
