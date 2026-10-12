/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Fragment, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	formatMoney,
	formatReportAmount,
	formatReportRate,
	periodLabel,
} from '../format.js';
import { Badge } from './SettlementList.js';

const BREAKDOWN_ID = 'fair-finance-settlements-report-breakdown';

/**
 * Show what a group of report lines adds up to.
 *
 * @param {Object}      group    Group total as `{ lines, amount }`.
 * @param {string|null} currency Report currency.
 * @return {string} Total, or why there is none.
 */
const groupTotal = ( group, currency ) => {
	if ( group.amount !== null ) {
		return formatMoney( group.amount, currency );
	}
	return group.lines === 0
		? __( 'Not provided by Mollie', 'fair-finance' )
		: __( 'Could not be totalled', 'fair-finance' );
};

/**
 * One labelled value of the summary or of a line's details.
 *
 * @param {Object}  props
 * @param {string}  props.label    Label.
 * @param {boolean} props.strong   Emphasize the value.
 * @param {*}       props.children Value.
 * @return {JSX.Element} Definition pair.
 */
const Row = ( { label, strong = false, children } ) => (
	<div className={ strong ? 'is-strong' : undefined }>
		<dt>{ label }</dt>
		<dd>{ children }</dd>
	</div>
);

/**
 * How the report compares with the payout. This is about the report only: it
 * never says that every movement was listed.
 *
 * @param {Object} summary Report summary.
 * @return {JSX.Element} Explanation.
 */
const Agreement = ( { summary } ) => {
	let text = __(
		'The report could not be compared with the payout.',
		'fair-finance'
	);
	if ( summary.check === 'verified' ) {
		text = __(
			'The report net equals the payout exactly.',
			'fair-finance'
		);
	} else if ( summary.check === 'mismatch' ) {
		text = sprintf(
			/* translators: %s: exact amount with currency, such as -0.0045 EUR */
			__(
				'The report net differs from the payout by %s.',
				'fair-finance'
			),
			formatMoney( summary.difference, summary.currency )
		);
	}

	return (
		<p className="fair-finance-settlements-agreement">
			<strong>{ text }</strong>{ ' ' }
			{ __(
				'This compares Mollie’s report with the payout only. It does not confirm that every movement is listed below.',
				'fair-finance'
			) }
		</p>
	);
};

/**
 * The lines of one period group, each with expandable details.
 *
 * @param {Object}   props
 * @param {string}   props.title    Group heading.
 * @param {Object[]} props.lines    Report lines.
 * @param {Set}      props.expanded Keys of the lines showing their details.
 * @param {Function} props.onToggle Called with a line's key.
 * @param {string}   props.prefix   Unique prefix for the lines' keys.
 * @return {JSX.Element|null} Table, or nothing for an empty group.
 */
const Lines = ( { title, lines, expanded, onToggle, prefix } ) => {
	if ( lines.length === 0 ) {
		return null;
	}

	const notProvided = __( 'Not provided by Mollie', 'fair-finance' );

	return (
		<>
			<h4>{ title }</h4>
			<table className="wp-list-table widefat striped fair-finance-settlements-table">
				<thead>
					<tr>
						<th>{ __( 'Description', 'fair-finance' ) }</th>
						<th>{ __( 'Method', 'fair-finance' ) }</th>
						<th>{ __( 'Count', 'fair-finance' ) }</th>
						<th>{ __( 'Gross amount', 'fair-finance' ) }</th>
						<th>{ __( 'Effect on payout', 'fair-finance' ) }</th>
						<th>
							<span className="screen-reader-text">
								{ __( 'Details', 'fair-finance' ) }
							</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{ lines.map( ( line ) => {
						const key = `${ prefix }-${ line.key }`;
						const open = expanded.has( key );
						const detailsId = `fair-finance-settlements-line-${ key }`;
						const name =
							line.description ||
							__( '(no description)', 'fair-finance' );

						return (
							<Fragment key={ key }>
								<tr>
									<td
										data-label={ __(
											'Description',
											'fair-finance'
										) }
									>
										{ name }
										{ line.is_refund && (
											<>
												{ ' ' }
												<Badge tone="neutral">
													{ __(
														'Refund',
														'fair-finance'
													) }
												</Badge>
											</>
										) }
										{ line.needs_review && (
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
											'Method',
											'fair-finance'
										) }
									>
										{ line.method || notProvided }
									</td>
									<td
										data-label={ __(
											'Count',
											'fair-finance'
										) }
									>
										{ line.count === null
											? notProvided
											: line.count }
									</td>
									<td
										data-label={ __(
											'Gross amount',
											'fair-finance'
										) }
									>
										{ formatReportAmount(
											line.amount_gross
										) }
									</td>
									<td
										data-label={ __(
											'Effect on payout',
											'fair-finance'
										) }
									>
										{ formatReportAmount(
											line.contribution
										) }
									</td>
									<td
										data-label={ __(
											'Details',
											'fair-finance'
										) }
									>
										<Button
											variant="link"
											aria-expanded={ open }
											aria-controls={ detailsId }
											onClick={ () => onToggle( key ) }
										>
											{ open
												? sprintf(
														/* translators: %s: report line description */
														__(
															'Hide details of %s',
															'fair-finance'
														),
														name
												  )
												: sprintf(
														/* translators: %s: report line description */
														__(
															'Show details of %s',
															'fair-finance'
														),
														name
												  ) }
										</Button>
									</td>
								</tr>
								{ open && (
									<tr
										id={ detailsId }
										className="fair-finance-settlements-line-details"
									>
										<td colSpan={ 6 }>
											<dl className="fair-finance-settlements-facts">
												<Row
													label={ __(
														'Net amount',
														'fair-finance'
													) }
												>
													{ formatReportAmount(
														line.amount_net
													) }
												</Row>
												<Row
													label={ __(
														'VAT',
														'fair-finance'
													) }
												>
													{ formatReportAmount(
														line.amount_vat
													) }
												</Row>
												<Row
													label={ __(
														'Gross amount',
														'fair-finance'
													) }
												>
													{ formatReportAmount(
														line.amount_gross
													) }
												</Row>
												<Row
													label={ __(
														'Fixed fee rate',
														'fair-finance'
													) }
												>
													{ formatReportAmount(
														line.rate_fixed
													) }
												</Row>
												<Row
													label={ __(
														'Percentage fee rate',
														'fair-finance'
													) }
												>
													{ formatReportRate(
														line.rate_percentage
													) }
												</Row>
											</dl>
										</td>
									</tr>
								) }
							</Fragment>
						);
					} ) }
				</tbody>
			</table>
		</>
	);
};

/**
 * Mollie's report of a settlement: what it adds up to against the payout,
 * and its lines by period at the precision Mollie supplied.
 *
 * @param {Object} props
 * @param {Object} props.report     Report from the settlement response.
 * @param {Object} props.settlement Settlement, for its payout.
 * @return {JSX.Element} Summary card.
 */
export default function SettlementReport( { report, settlement } ) {
	const [ showBreakdown, setShowBreakdown ] = useState( false );
	const [ expanded, setExpanded ] = useState( () => new Set() );

	const toggleLine = ( key ) =>
		setExpanded( ( current ) => {
			const next = new Set( current );
			if ( ! next.delete( key ) ) {
				next.add( key );
			}
			return next;
		} );

	const { summary } = report;
	const uncounted = summary
		? summary.missing + summary.invalid + summary.other_currency
		: 0;

	return (
		<Card className="fair-finance-settlements-card fair-finance-settlements-report">
			<CardHeader>
				<h2>{ __( 'Settlement summary', 'fair-finance' ) }</h2>
			</CardHeader>
			<CardBody>
				<p className="description">
					{ __(
						'Source: Mollie API. Mollie’s report describes the same settlement as the movements below. It is shown apart and is not added to them.',
						'fair-finance'
					) }
				</p>

				{ report.status === 'legacy' && (
					<Notice status="info" isDismissible={ false }>
						<strong>
							{ __(
								'Refresh to load report details',
								'fair-finance'
							) }
						</strong>{ ' ' }
						{ __(
							'This settlement was saved before Mollie’s report details were kept. Its report amounts are not available, which is not the same as zero. Use Refresh from Mollie to load them.',
							'fair-finance'
						) }
					</Notice>
				) }

				{ report.status === 'not_provided' && (
					<p>
						<strong>
							{ __( 'Not provided by Mollie', 'fair-finance' ) }
						</strong>{ ' ' }
						{ __(
							'Mollie sent no report for this settlement, so its income and costs cannot be summarized.',
							'fair-finance'
						) }
					</p>
				) }

				{ summary && (
					<>
						{ uncounted > 0 && (
							<Notice status="warning" isDismissible={ false }>
								{ sprintf(
									/* translators: %d: number of report amounts */
									_n(
										'%d report amount is missing, unreadable or in another currency, so the report is not totalled.',
										'%d report amounts are missing, unreadable or in another currency, so the report is not totalled.',
										uncounted,
										'fair-finance'
									),
									uncounted
								) }
							</Notice>
						) }
						<dl className="fair-finance-settlements-summary">
							<Row
								label={ __(
									'Revenue reported',
									'fair-finance'
								) }
							>
								{ groupTotal(
									summary.revenue,
									summary.currency
								) }
							</Row>
							{ summary.refunds.lines > 0 && (
								<Row
									label={ __(
										'Refunds reported',
										'fair-finance'
									) }
								>
									{ groupTotal(
										summary.refunds,
										summary.currency
									) }
								</Row>
							) }
							<Row
								label={ __(
									'Costs and adjustments',
									'fair-finance'
								) }
							>
								{ groupTotal(
									summary.costs,
									summary.currency
								) }
							</Row>
							<Row
								label={ __( 'Report net', 'fair-finance' ) }
								strong
							>
								{ summary.net === null
									? __( 'Not totalled', 'fair-finance' )
									: formatMoney(
											summary.net,
											summary.currency
									  ) }
							</Row>
							<Row label={ __( 'Payout', 'fair-finance' ) }>
								{ formatMoney(
									settlement.amount,
									settlement.currency
								) }
							</Row>
							<Row
								label={ __(
									'Difference from payout',
									'fair-finance'
								) }
							>
								{ summary.difference === null
									? __( 'Not available', 'fair-finance' )
									: formatMoney(
											summary.difference,
											summary.currency
									  ) }
							</Row>
						</dl>
						<Agreement summary={ summary } />

						<Button
							variant="secondary"
							aria-expanded={ showBreakdown }
							aria-controls={ BREAKDOWN_ID }
							onClick={ () =>
								setShowBreakdown( ! showBreakdown )
							}
						>
							{ showBreakdown
								? __(
										'Hide Mollie report breakdown',
										'fair-finance'
								  )
								: __(
										'Show Mollie report breakdown',
										'fair-finance'
								  ) }
						</Button>

						{ showBreakdown && (
							<div
								id={ BREAKDOWN_ID }
								className="fair-finance-settlements-breakdown"
							>
								{ report.periods.map( ( period, index ) => (
									<section key={ index }>
										<h3>{ periodLabel( period ) }</h3>
										{ ( period.invoice_reference ||
											period.invoice_id ) && (
											<p className="description">
												{ sprintf(
													/* translators: %s: Mollie invoice reference */
													__(
														'Mollie invoice: %s',
														'fair-finance'
													),
													period.invoice_reference ||
														period.invoice_id
												) }
											</p>
										) }
										<Lines
											title={ __(
												'Revenue',
												'fair-finance'
											) }
											lines={ period.revenue }
											expanded={ expanded }
											onToggle={ toggleLine }
											prefix={ `${ index }-revenue` }
										/>
										<Lines
											title={ __(
												'Costs',
												'fair-finance'
											) }
											lines={ period.costs }
											expanded={ expanded }
											onToggle={ toggleLine }
											prefix={ `${ index }-costs` }
										/>
									</section>
								) ) }
							</div>
						) }
					</>
				) }
			</CardBody>
		</Card>
	);
}
