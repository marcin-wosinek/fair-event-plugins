/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { createInterpolateElement } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	Spinner,
	__experimentalHStack as HStack,
	__experimentalText as Text,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import useImportRun from '../useImportRun.js';
import {
	LIST_URL,
	completenessBadge,
	formatDatetime,
	formatMoney,
	molliePaymentUrl,
	mollieSettlementUrl,
	settledTotals,
	settlementName,
	sourcesLabel,
	typeLabel,
} from '../format.js';
import { Badge } from './SettlementList.js';

const TRANSACTION_URL = 'admin.php?page=fair-payments-connector-transaction';

/**
 * Explain how far the saved data can be relied on.
 *
 * @param {Object} settlement Settlement.
 * @return {{status: string, text: string}|null} Notice, or null when verified.
 */
const completenessNotice = ( settlement ) => {
	if ( settlement.completeness === 'incomplete' ) {
		return {
			status: 'warning',
			text: __(
				'This settlement has not been fully loaded from Mollie yet. What is shown may be missing movements.',
				'fair-finance'
			),
		};
	}
	if ( settlement.completeness !== 'unverified' ) {
		return null;
	}
	if ( ! settlement.sources.includes( 'api' ) ) {
		return {
			status: 'info',
			text: __(
				'This settlement comes from an uploaded file. The payout amount, dates and Mollie status are not in the file and stay unknown until the settlement is loaded from Mollie.',
				'fair-finance'
			),
		};
	}
	return {
		status: 'info',
		text: __(
			'Every page Mollie lists for this settlement was loaded, but Mollie gave no summary that confirms the payout amount. The movements below may not be the whole payout.',
			'fair-finance'
		),
	};
};

/**
 * One labelled fact.
 *
 * @param {Object} props
 * @param {string} props.label    Label.
 * @param {*}      props.children Value.
 * @return {JSX.Element} Definition pair.
 */
const Fact = ( { label, children } ) => (
	<div>
		<dt>{ label }</dt>
		<dd>{ children }</dd>
	</div>
);

/**
 * A Mollie ID that opens its record in the Mollie dashboard, or the plain ID
 * when there is no address for it.
 *
 * @param {Object}      props
 * @param {string|null} props.href     Mollie dashboard URL.
 * @param {*}           props.children The ID as shown.
 * @return {JSX.Element} Link or plain ID.
 */
const MollieLink = ( { href, children } ) =>
	href ? (
		<a href={ href } target="_blank" rel="noopener noreferrer">
			{ children }
		</a>
	) : (
		children
	);

/**
 * One saved settlement: payout facts, where they came from, and movements.
 *
 * @param {Object}      props
 * @param {Object}      props.settlement Settlement.
 * @param {Object|null} props.connection What the Mollie connection allows.
 * @param {Function}    props.onChanged  Called when the saved data changed.
 * @return {JSX.Element} Detail view.
 */
export default function SettlementDetail( {
	settlement,
	connection,
	onChanged,
} ) {
	const { run, working, error, start, resume } = useImportRun( {
		onFinished: onChanged,
	} );

	const unknown = __( 'Unknown', 'fair-finance' );
	const badge = completenessBadge( settlement.completeness );
	const notice = completenessNotice( settlement );
	const canImport = connection?.can_import === true;
	const failedRun = ! working && run?.resumable;
	const api = settlement.revisions.api;
	const csv = settlement.revisions.csv;
	const organizationId = settlement.account?.organization_id;
	const settled = settledTotals( settlement.movements );

	return (
		<>
			<p>
				<a href={ LIST_URL }>
					{ __( '← All settlements', 'fair-finance' ) }
				</a>
			</p>
			<HStack justify="space-between" alignment="center" wrap>
				<h1>
					{ sprintf(
						/* translators: %s: settlement reference */
						__( 'Settlement %s', 'fair-finance' ),
						settlementName( settlement )
					) }{ ' ' }
					<Badge tone={ badge.tone }>{ badge.label }</Badge>
				</h1>
				{ settlement.provider_id && (
					<Button
						variant="secondary"
						onClick={ () => start( 'refresh', settlement.id ) }
						disabled={
							working || ! canImport || ! settlement.can_refresh
						}
						isBusy={ working }
					>
						{ __( 'Refresh from Mollie', 'fair-finance' ) }
					</Button>
				) }
			</HStack>

			{ settlement.provider_id &&
				connection &&
				( ! canImport || ! settlement.can_refresh ) && (
					<p className="description">
						{ ! canImport
							? connection.problem_message
							: __(
									'This settlement belongs to a different Mollie organization than the one connected, so it cannot be refreshed.',
									'fair-finance'
							  ) }
					</p>
				) }

			{ working && (
				<HStack justify="flex-start" role="status">
					<Spinner />
					<Text>
						{ __( 'Refreshing from Mollie…', 'fair-finance' ) }
					</Text>
				</HStack>
			) }

			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			{ failedRun && (
				<Notice
					status="warning"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Try again', 'fair-finance' ),
							onClick: resume,
						},
					] }
				>
					{ run.error_message }
				</Notice>
			) }

			{ ! working && run?.status === 'completed' && (
				<Notice status="success" isDismissible={ false }>
					{ __( 'Refreshed from Mollie.', 'fair-finance' ) }
				</Notice>
			) }

			{ notice && (
				<Notice status={ notice.status } isDismissible={ false }>
					{ notice.text }
				</Notice>
			) }

			{ settlement.last_failure && ! failedRun && (
				<Notice status="warning" isDismissible={ false }>
					<strong>
						{ sprintf(
							/* translators: %s: date and time */
							__(
								'The last attempt to load this settlement from Mollie failed on %s.',
								'fair-finance'
							),
							formatDatetime( settlement.last_failure.at )
						) }
					</strong>{ ' ' }
					{ settlement.last_failure.message }{ ' ' }
					{ settlement.sources.length > 0 &&
						__(
							'The data below is from the last complete load.',
							'fair-finance'
						) }
				</Notice>
			) }

			{ settlement.discrepancies.length > 0 && (
				<Notice status="warning" isDismissible={ false }>
					<strong>{ __( 'To review', 'fair-finance' ) }</strong>
					<ul className="fair-finance-settlements-errors">
						{ settlement.discrepancies.map(
							( discrepancy, index ) => (
								<li key={ index }>{ discrepancy.message }</li>
							)
						) }
					</ul>
				</Notice>
			) }

			<Card className="fair-finance-settlements-card">
				<CardHeader>
					<h2>{ __( 'Payout', 'fair-finance' ) }</h2>
				</CardHeader>
				<CardBody>
					<dl className="fair-finance-settlements-facts">
						<Fact
							label={ __( 'Payout reference', 'fair-finance' ) }
						>
							{ settlement.reference || unknown }
						</Fact>
						<Fact label={ __( 'Payout amount', 'fair-finance' ) }>
							{ formatMoney(
								settlement.amount,
								settlement.currency
							) }
						</Fact>
						<Fact label={ __( 'Currency', 'fair-finance' ) }>
							{ settlement.currency || unknown }
						</Fact>
						<Fact label={ __( 'Mollie status', 'fair-finance' ) }>
							{ settlement.status || unknown }
						</Fact>
						<Fact label={ __( 'Paid out', 'fair-finance' ) }>
							{ formatDatetime( settlement.settled_at, unknown ) }
						</Fact>
						<Fact label={ __( 'Created', 'fair-finance' ) }>
							{ formatDatetime( settlement.created_at, unknown ) }
						</Fact>
						<Fact label={ __( 'Mollie account', 'fair-finance' ) }>
							{ settlement.account?.label }
							{ settlement.account &&
								! settlement.account.verified && (
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
						</Fact>
						<Fact
							label={ __(
								'Mollie settlement ID',
								'fair-finance'
							) }
						>
							{ settlement.provider_id ? (
								<MollieLink
									href={ mollieSettlementUrl(
										organizationId,
										settlement.provider_id
									) }
								>
									{ settlement.provider_id }
								</MollieLink>
							) : (
								unknown
							) }
						</Fact>
						<Fact label={ __( 'Mollie invoice', 'fair-finance' ) }>
							{ settlement.invoice_id || unknown }
						</Fact>
						<Fact label={ __( 'Source', 'fair-finance' ) }>
							{ sourcesLabel( settlement.sources ) }
						</Fact>
						<Fact
							label={ __(
								'Last loaded from Mollie',
								'fair-finance'
							) }
						>
							{ formatDatetime(
								settlement.last_refreshed_at,
								__( 'Never', 'fair-finance' )
							) }
						</Fact>
						<Fact
							label={ __( 'Last file import', 'fair-finance' ) }
						>
							{ formatDatetime(
								settlement.last_csv_import_at,
								__( 'Never', 'fair-finance' )
							) }
						</Fact>
					</dl>
				</CardBody>
			</Card>

			{ ( api || csv ) && (
				<Card className="fair-finance-settlements-card">
					<CardHeader>
						<h2>{ __( 'What was loaded', 'fair-finance' ) }</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'Totals are kept per source and are never added together. The payout amount above is what Mollie reported, not a sum of these rows.',
								'fair-finance'
							) }
						</p>
						<div>
							<table className="wp-list-table widefat striped fair-finance-settlements-table">
								<thead>
									<tr>
										<th>
											{ __( 'Source', 'fair-finance' ) }
										</th>
										<th>
											{ __( 'Rows', 'fair-finance' ) }
										</th>
										<th>
											{ __(
												'Total settled',
												'fair-finance'
											) }
										</th>
									</tr>
								</thead>
								<tbody>
									{ [
										[ 'api', api ],
										[ 'csv', csv ],
									]
										.filter(
											( [ , revision ] ) => revision
										)
										.flatMap( ( [ source, revision ] ) =>
											Object.entries(
												revision.totals.by_type
											).map( ( [ type, total ] ) => (
												<tr
													key={ `${ source }-${ type }` }
												>
													<td
														data-label={ __(
															'Source',
															'fair-finance'
														) }
													>
														{ sourcesLabel( [
															source,
														] ) }
													</td>
													<td
														data-label={ __(
															'Rows',
															'fair-finance'
														) }
													>
														{ sprintf(
															/* translators: 1: movement type, 2: number of rows */
															__(
																'%1$s (%2$d)',
																'fair-finance'
															),
															typeLabel( type ),
															total.count
														) }
													</td>
													<td
														data-label={ __(
															'Total settled',
															'fair-finance'
														) }
													>
														{ formatMoney(
															total.settlement_amount,
															total.currency
														) }
													</td>
												</tr>
											) )
										) }
								</tbody>
							</table>
						</div>
						{ api?.totals.payments_settled_by_captures > 0 && (
							<p className="description">
								{ sprintf(
									/* translators: %d: number of payments */
									_n(
										'%d payment was settled through its captures and is not counted on top of them.',
										'%d payments were settled through their captures and are not counted on top of them.',
										api.totals.payments_settled_by_captures,
										'fair-finance'
									),
									api.totals.payments_settled_by_captures
								) }
							</p>
						) }
					</CardBody>
				</Card>
			) }

			{ settlement.proposed_changes.map( ( proposed ) => (
				<Card
					key={ proposed.revision_id }
					className="fair-finance-settlements-card"
				>
					<CardHeader>
						<h2>
							{ sprintf(
								/* translators: %s: date and time */
								__(
									'Differences in the file uploaded on %s',
									'fair-finance'
								),
								formatDatetime( proposed.created_at )
							) }
						</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'This file was not applied. The saved data is unchanged.',
								'fair-finance'
							) }
						</p>
						<ul className="fair-finance-settlements-errors">
							{ proposed.changed.map( ( change ) => (
								<li key={ `c-${ change.identity_key }` }>
									{ sprintf(
										/* translators: 1: Mollie reference or description, 2: saved amount, 3: amount in the file */
										__(
											'%1$s: saved %2$s, file says %3$s',
											'fair-finance'
										),
										change.external_id ||
											change.description,
										change.fields.settlement_amount
											?.accepted ?? unknown,
										change.fields.settlement_amount
											?.proposed ?? unknown
									) }
								</li>
							) ) }
							{ proposed.added.map( ( movement, index ) => (
								<li key={ `a-${ index }` }>
									{ sprintf(
										/* translators: 1: Mollie reference or description, 2: amount */
										__(
											'Only in the file: %1$s (%2$s)',
											'fair-finance'
										),
										movement.external_id ||
											movement.description,
										formatMoney(
											movement.settlement_amount,
											movement.settlement_currency
										)
									) }
								</li>
							) ) }
							{ proposed.removed.map( ( movement, index ) => (
								<li key={ `r-${ index }` }>
									{ sprintf(
										/* translators: 1: Mollie reference or description, 2: amount */
										__(
											'Missing from the file: %1$s (%2$s)',
											'fair-finance'
										),
										movement.external_id ||
											movement.description,
										formatMoney(
											movement.settlement_amount,
											movement.settlement_currency
										)
									) }
								</li>
							) ) }
						</ul>
					</CardBody>
				</Card>
			) ) }

			<Card className="fair-finance-settlements-card">
				<CardHeader>
					<h2>{ __( 'Movements', 'fair-finance' ) }</h2>
				</CardHeader>
				<CardBody>
					{ settlement.unresolved_payment_count > 0 && (
						<p className="description">
							{ sprintf(
								/* translators: %d: number of payments */
								_n(
									'%d payment is not in this site’s transactions yet. Its reference is kept and links up once the payment is imported.',
									'%d payments are not in this site’s transactions yet. Their references are kept and link up once the payments are imported.',
									settlement.unresolved_payment_count,
									'fair-finance'
								),
								settlement.unresolved_payment_count
							) }
						</p>
					) }
					{ settlement.movements.length === 0 ? (
						<p>
							{ __(
								'No movements are saved for this settlement.',
								'fair-finance'
							) }
						</p>
					) : (
						<table className="wp-list-table widefat striped fair-finance-settlements-table">
							<thead>
								<tr>
									<th>{ __( 'Type', 'fair-finance' ) }</th>
									<th>
										{ __( 'Reference', 'fair-finance' ) }
									</th>
									<th>
										{ __( 'Description', 'fair-finance' ) }
									</th>
									<th>{ __( 'Date', 'fair-finance' ) }</th>
									<th>{ __( 'Amount', 'fair-finance' ) }</th>
									<th>{ __( 'Settled', 'fair-finance' ) }</th>
									<th>{ __( 'Source', 'fair-finance' ) }</th>
									<th>
										{ __(
											'Local payment',
											'fair-finance'
										) }
									</th>
								</tr>
							</thead>
							<tbody>
								{ settlement.movements.map( ( movement ) => (
									<tr key={ movement.key }>
										<td
											data-label={ __(
												'Type',
												'fair-finance'
											) }
										>
											{ typeLabel( movement.type ) }
											{ movement.needs_review && (
												<>
													{ ' ' }
													<Badge tone="warning">
														{ __(
															'Review',
															'fair-finance'
														) }
													</Badge>
												</>
											) }
										</td>
										<td
											data-label={ __(
												'Reference',
												'fair-finance'
											) }
										>
											<MollieLink
												href={ molliePaymentUrl(
													organizationId,
													movement.external_id
												) }
											>
												<code>
													{ movement.external_id }
												</code>
											</MollieLink>
											{ movement.payment_reference !==
												movement.external_id &&
												molliePaymentUrl(
													organizationId,
													movement.payment_reference
												) && (
													<div className="fair-finance-settlements-parent">
														{ createInterpolateElement(
															__(
																'For payment <payment />',
																'fair-finance'
															),
															{
																payment: (
																	<MollieLink
																		href={ molliePaymentUrl(
																			organizationId,
																			movement.payment_reference
																		) }
																	>
																		<code>
																			{
																				movement.payment_reference
																			}
																		</code>
																	</MollieLink>
																),
															}
														) }
													</div>
												) }
										</td>
										<td
											data-label={ __(
												'Description',
												'fair-finance'
											) }
										>
											{ movement.description ||
												__(
													'(no description)',
													'fair-finance'
												) }
										</td>
										<td
											data-label={ __(
												'Date',
												'fair-finance'
											) }
										>
											{ formatDatetime(
												movement.occurred_at,
												unknown
											) }
										</td>
										<td
											data-label={ __(
												'Amount',
												'fair-finance'
											) }
										>
											{ formatMoney(
												movement.amount,
												movement.currency
											) }
										</td>
										<td
											data-label={ __(
												'Settled',
												'fair-finance'
											) }
										>
											{ formatMoney(
												movement.settlement_amount,
												movement.settlement_currency
											) }
											{ movement.conflict
												?.settlement_amount && (
												<div className="fair-finance-settlements-conflict">
													{ sprintf(
														/* translators: %s: amount stated in the uploaded file */
														__(
															'File says %s',
															'fair-finance'
														),
														movement.conflict
															.settlement_amount
															.csv
													) }
												</div>
											) }
										</td>
										<td
											data-label={ __(
												'Source',
												'fair-finance'
											) }
										>
											{ sourcesLabel( movement.sources ) }
										</td>
										<td
											data-label={ __(
												'Local payment',
												'fair-finance'
											) }
										>
											{ movement.local_transaction_id && (
												<a
													href={ `${ TRANSACTION_URL }&transaction_id=${ movement.local_transaction_id }` }
												>
													{ sprintf(
														/* translators: %d: transaction ID */
														__(
															'Transaction #%d',
															'fair-finance'
														),
														movement.local_transaction_id
													) }
												</a>
											) }
											{ ! movement.local_transaction_id &&
												( movement.payment_reference
													? __(
															'Not imported yet',
															'fair-finance'
													  )
													: unknown ) }
										</td>
									</tr>
								) ) }
							</tbody>
							<tfoot>
								<tr className="fair-finance-settlements-totals">
									<th scope="row" colSpan={ 5 }>
										{ __( 'Totals', 'fair-finance' ) }
									</th>
									<td
										data-label={ __(
											'Settled',
											'fair-finance'
										) }
									>
										<div>
											{ settled.totals.map( ( total ) => (
												<div key={ total.currency }>
													{ formatMoney(
														total.amount,
														total.currency
													) }
												</div>
											) ) }
											{ settled.unknown > 0 && (
												<div className="fair-finance-settlements-conflict">
													{ sprintf(
														/* translators: %d: number of rows */
														_n(
															'Partial: %d row with an unknown amount is left out.',
															'Partial: %d rows with unknown amounts are left out.',
															settled.unknown,
															'fair-finance'
														),
														settled.unknown
													) }
												</div>
											) }
										</div>
									</td>
									<td colSpan={ 2 } />
								</tr>
							</tfoot>
						</table>
					) }
					{ settlement.movements.length > 0 && (
						<p className="description">
							{ __(
								'Totals add up the Settled column of the rows above. They are not the payout amount and do not confirm it.',
								'fair-finance'
							) }
						</p>
					) }
				</CardBody>
			</Card>

			{ settlement.aggregates.length > 0 && (
				<Card className="fair-finance-settlements-card">
					<CardHeader>
						<h2>
							{ __( 'Summed rows and fees', 'fair-finance' ) }
						</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'These rows are totals reported by the source, not single movements. They may cover the same money as the movements above, so they are shown apart and not added to them.',
								'fair-finance'
							) }
						</p>
						<table className="wp-list-table widefat striped fair-finance-settlements-table">
							<thead>
								<tr>
									<th>{ __( 'Type', 'fair-finance' ) }</th>
									<th>
										{ __( 'Description', 'fair-finance' ) }
									</th>
									<th>{ __( 'Amount', 'fair-finance' ) }</th>
									<th>{ __( 'Source', 'fair-finance' ) }</th>
								</tr>
							</thead>
							<tbody>
								{ settlement.aggregates.map( ( row ) => (
									<tr key={ row.key }>
										<td
											data-label={ __(
												'Type',
												'fair-finance'
											) }
										>
											{ typeLabel( row.type ) }
										</td>
										<td
											data-label={ __(
												'Description',
												'fair-finance'
											) }
										>
											{ row.description ||
												__(
													'(no description)',
													'fair-finance'
												) }
										</td>
										<td
											data-label={ __(
												'Amount',
												'fair-finance'
											) }
										>
											{ formatMoney(
												row.settlement_amount,
												row.settlement_currency
											) }
										</td>
										<td
											data-label={ __(
												'Source',
												'fair-finance'
											) }
										>
											{ sourcesLabel( row.sources ) }
										</td>
									</tr>
								) ) }
							</tbody>
						</table>
					</CardBody>
				</Card>
			) }
		</>
	);
}
