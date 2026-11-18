/**
 * Event result at the top of the Finance tab (#2398)
 *
 * Total sales, total costs including fees and the net event result, then
 * how each total was reached and where the online money is on its way to
 * the bank. Every figure comes from the finance-summary route, which counts
 * each payment once over all of the event's payments.
 *
 * @package FairEvents
 */

import {
	Card,
	CardHeader,
	CardBody,
	Notice,
	Button,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * Format an amount in the summary's currency.
 *
 * @param {number} amount   Amount.
 * @param {string} currency ISO currency code.
 * @return {string} Formatted amount.
 */
export function formatSummaryAmount( amount, currency = 'EUR' ) {
	try {
		return new Intl.NumberFormat( 'en-US', {
			style: 'currency',
			currency: currency || 'EUR',
		} ).format( amount || 0 );
	} catch {
		return `${ Number( amount || 0 ).toFixed( 2 ) } ${ currency }`;
	}
}

/**
 * Why the summary is incomplete, one sentence per reason.
 *
 * @param {Object} summary Summary from the finance-summary route.
 * @return {string[]} Messages.
 */
export function summaryIssueMessages( summary ) {
	const unallocated = summary?.sales?.online?.unallocated || 0;
	return ( summary?.issues || [] ).map( ( issue ) => {
		switch ( issue ) {
			case 'online_unavailable':
				return __(
					'Online payments can’t be read, so they are left out. Check that Fair Payments Connector is active.',
					'fair-events'
				);
			case 'online_unallocated':
				return sprintf(
					/* translators: %d: number of paid payments */
					_n(
						'%d paid payment for this event isn’t fully assigned to its purchases yet, so part of it may be missing from sales.',
						'%d paid payments for this event aren’t fully assigned to their purchases yet, so part of them may be missing from sales.',
						unallocated,
						'fair-events'
					),
					unallocated
				);
			case 'fees_missing':
				return __(
					'Payment fees aren’t recorded yet for some online payments, so costs leave them out and the net result may be too high.',
					'fair-events'
				);
			case 'other_currency':
				return __(
					'Online payments in another currency than the site’s are left out.',
					'fair-events'
				);
			case 'finance_inactive':
				return __(
					'Expenses and cash sales are left out because Fair Finance is inactive.',
					'fair-events'
				);
			case 'finance_unavailable':
				return __(
					'Expenses and cash sales could not be loaded, so they are left out.',
					'fair-events'
				);
			case 'currency_mismatch':
				return __(
					'Fair Finance records amounts in euros, but the site currency is different, so the totals mix currencies.',
					'fair-events'
				);
			default:
				return issue;
		}
	} );
}

/**
 * One headline figure.
 *
 * @param {Object}  props
 * @param {string}  props.label    Caption.
 * @param {?number} props.amount   Amount, or null when not available.
 * @param {string}  props.currency Currency.
 * @param {boolean} props.strong   Emphasize the figure.
 */
function Headline( { label, amount, currency, strong = false } ) {
	return (
		<div
			style={ {
				flex: '1 1 180px',
				minWidth: '160px',
				padding: '12px',
				border: '1px solid #dcdcde',
				borderRadius: '4px',
				background: strong ? '#f6f7f7' : undefined,
			} }
		>
			<div style={ { color: '#50575e' } }>{ label }</div>
			<div
				style={ {
					fontSize: '24px',
					fontWeight: strong ? 700 : 600,
					marginTop: '4px',
					overflowWrap: 'anywhere',
				} }
			>
				{ null === amount || undefined === amount
					? __( 'Not available', 'fair-events' )
					: formatSummaryAmount( amount, currency ) }
			</div>
		</div>
	);
}

/**
 * A labelled amount in a breakdown list.
 *
 * @param {Object}  props
 * @param {string}  props.label    Label.
 * @param {?number} props.amount   Amount, or null when not available.
 * @param {string}  props.currency Currency.
 * @param {boolean} props.total    Render as the list's total.
 * @param {Element} props.children Extra content below the row.
 */
function Row( { label, amount, currency, total = false, children } ) {
	return (
		<li
			style={ {
				padding: '4px 0',
				borderTop: total ? '1px solid #dcdcde' : undefined,
				fontWeight: total ? 600 : undefined,
			} }
		>
			<div
				style={ {
					display: 'flex',
					justifyContent: 'space-between',
					gap: '12px',
					flexWrap: 'wrap',
				} }
			>
				<span>{ label }</span>
				<span style={ { whiteSpace: 'nowrap' } }>
					{ null === amount || undefined === amount
						? __( 'Not available', 'fair-events' )
						: formatSummaryAmount( amount, currency ) }
				</span>
			</div>
			{ children }
		</li>
	);
}

/**
 * Indented list of rows under a breakdown row.
 *
 * @param {Object}  props
 * @param {string}  props.label    Accessible name.
 * @param {Element} props.children Rows.
 */
function SubList( { label, children } ) {
	return (
		<ul
			aria-label={ label }
			style={ {
				margin: '2px 0 0',
				paddingLeft: '16px',
				listStyle: 'none',
				color: '#50575e',
				fontSize: '13px',
			} }
		>
			{ children }
		</ul>
	);
}

/**
 * A titled breakdown column.
 *
 * @param {Object}  props
 * @param {string}  props.title    Heading.
 * @param {Element} props.children Content.
 */
function Breakdown( { title, children } ) {
	return (
		<section style={ { flex: '1 1 280px', minWidth: 0 } }>
			<h3 style={ { margin: '0 0 8px', fontSize: '14px' } }>{ title }</h3>
			{ children }
		</section>
	);
}

const listStyle = { margin: 0, padding: 0, listStyle: 'none' };

/**
 * Where the online money is on its way to the bank.
 *
 * @param {Object} props
 * @param {Object} props.payout   Payout part of the summary.
 * @param {string} props.currency Currency.
 */
function PayoutStatus( { payout, currency } ) {
	const states = [
		[ 'awaiting_payout', __( 'Awaiting payout', 'fair-events' ) ],
		[ 'paid_out', __( 'Paid out by Mollie', 'fair-events' ) ],
		[ 'received_in_bank', __( 'Received in bank', 'fair-events' ) ],
		[ 'unknown', __( 'Payout status unknown', 'fair-events' ) ],
	].filter( ( [ key ] ) => payout[ key ] > 0 );
	const unpriced = payout.unpriced_count || 0;

	if ( 0 === states.length && 0 === unpriced ) {
		return null;
	}

	return (
		<div style={ { marginTop: '12px' } } data-testid="payout-status">
			<h4 style={ { margin: '0 0 4px', fontSize: '13px' } }>
				{ __( 'Bank payout status', 'fair-events' ) }
			</h4>
			<ul style={ listStyle }>
				{ states.map( ( [ key, label ] ) => (
					<Row
						key={ key }
						label={ label }
						amount={ payout[ key ] }
						currency={ currency }
					/>
				) ) }
			</ul>
			{ unpriced > 0 && (
				<p style={ { margin: '4px 0 0', color: '#50575e' } }>
					{ sprintf(
						/* translators: %d: number of payments */
						_n(
							'Payout status unknown for %d more payment whose fees aren’t recorded yet.',
							'Payout status unknown for %d more payments whose fees aren’t recorded yet.',
							unpriced,
							'fair-events'
						),
						unpriced
					) }
				</p>
			) }
			<p
				style={ {
					margin: '4px 0 0',
					color: '#757575',
					fontSize: '12px',
				} }
			>
				{ __(
					'Amounts after fees. A payout doesn’t change the event result. “Received in bank” needs a confirmed bank reconciliation.',
					'fair-events'
				) }
			</p>
		</div>
	);
}

/**
 * Event result card.
 *
 * @param {Object}      props
 * @param {Object|null} props.summary Summary, once loaded.
 * @param {boolean}     props.loading Summary is loading.
 * @param {string|null} props.error   Load error.
 * @param {Function}    props.onRetry Reload the summary.
 * @return {Element} The card.
 */
export default function FinanceSummary( { summary, loading, error, onRetry } ) {
	const currency = summary?.currency || 'EUR';
	const online = summary?.sales?.online;
	const expenses = summary?.costs?.expenses;
	const issues = summaryIssueMessages( summary );

	return (
		<Card>
			<CardHeader>
				<h2>{ __( 'Event result', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ loading && ! summary && (
						<div style={ { textAlign: 'center', padding: '20px' } }>
							<Spinner />
						</div>
					) }

					{ error && (
						<Notice status="error" isDismissible={ false }>
							<p style={ { margin: 0 } }>{ error }</p>
							{ onRetry && (
								<Button
									variant="link"
									onClick={ onRetry }
									disabled={ loading }
								>
									{ __( 'Try again', 'fair-events' ) }
								</Button>
							) }
						</Notice>
					) }

					{ summary?.sales && summary?.costs && (
						<>
							<div
								style={ {
									display: 'flex',
									flexWrap: 'wrap',
									gap: '12px',
									maxWidth: '960px',
								} }
								data-testid="finance-headline"
							>
								<Headline
									label={ __( 'Total sales', 'fair-events' ) }
									amount={ summary.sales.total }
									currency={ currency }
								/>
								<Headline
									label={ __(
										'Total costs, including fees',
										'fair-events'
									) }
									amount={ summary.costs.total }
									currency={ currency }
								/>
								<Headline
									label={ __(
										'Net event result',
										'fair-events'
									) }
									amount={ summary.net_result }
									currency={ currency }
									strong
								/>
							</div>

							{ issues.length > 0 && (
								<Notice
									status="warning"
									isDismissible={ false }
								>
									<p style={ { margin: 0 } }>
										<strong>
											{ __(
												'Incomplete: the net result isn’t final.',
												'fair-events'
											) }
										</strong>
									</p>
									<ul
										style={ {
											margin: '4px 0 0',
											paddingLeft: '16px',
											listStyle: 'disc',
										} }
									>
										{ issues.map( ( message ) => (
											<li key={ message }>{ message }</li>
										) ) }
									</ul>
								</Notice>
							) }

							<div
								style={ {
									display: 'flex',
									flexWrap: 'wrap',
									gap: '24px',
									maxWidth: '960px',
								} }
							>
								<Breakdown
									title={ __( 'Sales', 'fair-events' ) }
								>
									<ul
										style={ listStyle }
										aria-label={ __(
											'Sales breakdown',
											'fair-events'
										) }
									>
										<Row
											label={ __(
												'Online payments',
												'fair-events'
											) }
											amount={
												online ? online.gross : null
											}
											currency={ currency }
										>
											{ online && (
												<SubList
													label={ __(
														'Online payments after fees',
														'fair-events'
													) }
												>
													<Row
														label={ __(
															'Mollie fees',
															'fair-events'
														) }
														amount={
															online.mollie_fees
														}
														currency={ currency }
													/>
													<Row
														label={ __(
															'Fair Events fees',
															'fair-events'
														) }
														amount={
															online.application_fees
														}
														currency={ currency }
													/>
													<Row
														label={
															online.fees_complete
																? __(
																		'After fees',
																		'fair-events'
																	)
																: __(
																		'After recorded fees',
																		'fair-events'
																	)
														}
														amount={ online.net }
														currency={ currency }
													/>
												</SubList>
											) }
										</Row>
										<Row
											label={ __(
												'Cash sales',
												'fair-events'
											) }
											amount={ summary.sales.cash }
											currency={ currency }
										/>
										<Row
											label={ __(
												'Total sales',
												'fair-events'
											) }
											amount={ summary.sales.total }
											currency={ currency }
											total
										/>
									</ul>
									{ summary.payout && (
										<PayoutStatus
											payout={ summary.payout }
											currency={ currency }
										/>
									) }
								</Breakdown>

								<Breakdown
									title={ __( 'Costs', 'fair-events' ) }
								>
									<ul
										style={ listStyle }
										aria-label={ __(
											'Costs breakdown',
											'fair-events'
										) }
									>
										<Row
											label={ __(
												'Recorded expenses',
												'fair-events'
											) }
											amount={
												expenses ? expenses.total : null
											}
											currency={ currency }
										>
											{ expenses && (
												<SubList
													label={ __(
														'Expenses by how they were paid',
														'fair-events'
													) }
												>
													<Row
														label={ __(
															'Paid from the bank',
															'fair-events'
														) }
														amount={ expenses.bank }
														currency={ currency }
													/>
													<Row
														label={ __(
															'Paid from event cash',
															'fair-events'
														) }
														amount={
															expenses.event_cash
														}
														currency={ currency }
													/>
													<Row
														label={ __(
															'Paid personally',
															'fair-events'
														) }
														amount={
															expenses.personal
														}
														currency={ currency }
													>
														{ expenses
															.personal_by_payer
															?.length > 0 && (
															<SubList
																label={ __(
																	'Personally paid by payer',
																	'fair-events'
																) }
															>
																{ expenses.personal_by_payer.map(
																	(
																		payer
																	) => (
																		<Row
																			key={
																				payer.payer_name
																			}
																			label={
																				payer.payer_name ||
																				__(
																					'(no name)',
																					'fair-events'
																				)
																			}
																			amount={
																				payer.amount
																			}
																			currency={
																				currency
																			}
																		/>
																	)
																) }
															</SubList>
														) }
													</Row>
													{ expenses.unclassified >
														0 && (
														<Row
															label={ __(
																'Payment method not recorded',
																'fair-events'
															) }
															amount={
																expenses.unclassified
															}
															currency={
																currency
															}
														/>
													) }
												</SubList>
											) }
										</Row>
										<Row
											label={ __(
												'Payment fees',
												'fair-events'
											) }
											amount={
												summary.costs.payment_fees
											}
											currency={ currency }
										/>
										<Row
											label={ __(
												'Total costs',
												'fair-events'
											) }
											amount={ summary.costs.total }
											currency={ currency }
											total
										/>
									</ul>
								</Breakdown>
							</div>
						</>
					) }
				</VStack>
			</CardBody>
		</Card>
	);
}
