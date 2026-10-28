/**
 * Event Finance Component
 *
 * Shows payments and costs for the current event date. Rendered when Fair
 * Payments Connector or Fair Finance is active.
 *
 * @package FairEvents
 */

import { useState, useEffect, Fragment } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const siteCurrency = window.fairPaymentsConnector?.currency || 'EUR';

const formatAmount = ( amount ) => {
	return new Intl.NumberFormat( 'en-US', {
		style: 'currency',
		currency: siteCurrency,
	} ).format( amount );
};

const computeNetReceived = ( tx ) => {
	if ( tx.mollie_fee === null || tx.mollie_fee === undefined ) {
		return null;
	}
	const fees = ( tx.mollie_fee || 0 ) + ( tx.application_fee || 0 );
	return ( tx.amount || 0 ) - fees;
};

const renderParticipant = ( tx ) => {
	const participant = tx.participant;
	if ( participant?.name && participant?.admin_url ) {
		return <a href={ participant.admin_url }>{ participant.name }</a>;
	}
	if ( participant?.name ) {
		return participant.name;
	}
	if ( tx.user_name ) {
		return tx.user_name;
	}
	return <em>-</em>;
};

/**
 * One headline figure in the summary row.
 *
 * @param {Object} props
 * @param {string} props.label Caption under the figure.
 * @param {string} props.value Formatted amount.
 * @param {string} props.color Text color of the figure.
 * @param {string} props.title Optional tooltip.
 */
function SummaryStat( { label, value, color, title } ) {
	return (
		<div style={ { textAlign: 'center' } } title={ title }>
			<div
				style={ {
					fontSize: '24px',
					fontWeight: 'bold',
					color,
				} }
			>
				{ value }
			</div>
			<div style={ { color: '#666' } }>{ label }</div>
		</div>
	);
}

// Name the section that failed, then add the server's own explanation.
const loadErrorMessage = ( err, summary ) =>
	err?.message ? `${ summary } ${ err.message }` : summary;

/**
 * Finance tab of Manage Event.
 *
 * Payments come from Fair Payments Connector; costs, accounting entries and
 * budgets from Fair Finance. Each source loads on its own and only when its
 * plugin is active, so one missing or failing plugin never hides the other's
 * data or shows it as a zero total.
 *
 * @param {Object}  props
 * @param {number}  props.eventDateId     Event date being managed.
 * @param {boolean} props.connectorActive Fair Payments Connector is active.
 * @param {boolean} props.financeActive   Fair Finance is active.
 * @param {string}  props.entriesUrl      Fair Finance entries screen URL.
 */
export default function EventFinance( {
	eventDateId,
	connectorActive,
	financeActive,
	entriesUrl,
} ) {
	// Payments (Fair Payments Connector). `null` until loaded.
	const [ payments, setPayments ] = useState( null );
	const [ paymentsLoading, setPaymentsLoading ] = useState(
		!! ( connectorActive && eventDateId )
	);
	const [ paymentsError, setPaymentsError ] = useState( null );

	// Costs (Fair Finance). `null` until loaded.
	const [ accounting, setAccounting ] = useState( null );
	const [ accountingLoading, setAccountingLoading ] = useState(
		!! ( financeActive && eventDateId )
	);
	const [ accountingError, setAccountingError ] = useState( null );

	// Budget link (#1608): which fair-finance budget this event's payments
	// should preselect during reconciliation. '' means "no budget".
	const [ budgets, setBudgets ] = useState( [] );
	const [ budgetId, setBudgetId ] = useState( '' );
	const [ savedBudgetId, setSavedBudgetId ] = useState( '' );
	const [ budgetLoading, setBudgetLoading ] = useState(
		!! ( financeActive && eventDateId )
	);
	const [ budgetLoadError, setBudgetLoadError ] = useState( null );
	const [ budgetSaving, setBudgetSaving ] = useState( false );
	const [ budgetError, setBudgetError ] = useState( null );
	const [ budgetSuccess, setBudgetSuccess ] = useState( null );

	useEffect( () => {
		if ( ! eventDateId ) {
			return;
		}
		if ( connectorActive ) {
			loadPayments();
		}
		if ( financeActive ) {
			loadAccounting();
			loadBudget();
		}
	}, [ eventDateId, connectorActive, financeActive ] );

	const loadPayments = async () => {
		setPaymentsLoading( true );
		setPaymentsError( null );

		const fetchStatus = ( status ) =>
			apiFetch( {
				path: `/fair-payments-connector/v1/transactions?event_date_id=${ eventDateId }&status=${ status }&mode=live&per_page=100`,
			} );

		try {
			const [ paidData, failedData, canceledData, expiredData ] =
				await Promise.all( [
					fetchStatus( 'paid' ),
					fetchStatus( 'failed' ),
					fetchStatus( 'canceled' ),
					fetchStatus( 'expired' ),
				] );

			const paid = paidData.transactions || [];
			const income = paid.reduce(
				( sum, tx ) => sum + ( tx.amount || 0 ),
				0
			);
			// Sum nets only for transactions where Mollie fee data has been
			// recorded — partial sums would mislead.
			let net = 0;
			let netComplete = paid.length > 0;
			for ( const tx of paid ) {
				const txNet = computeNetReceived( tx );
				if ( txNet === null ) {
					netComplete = false;
				} else {
					net += txNet;
				}
			}

			const failed = [
				...( failedData.transactions || [] ),
				...( canceledData.transactions || [] ),
				...( expiredData.transactions || [] ),
			].sort( ( a, b ) =>
				( b.created_at || '' ).localeCompare( a.created_at || '' )
			);

			setPayments( { paid, failed, income, net, netComplete } );
		} catch ( err ) {
			setPayments( null );
			setPaymentsError(
				loadErrorMessage(
					err,
					__( 'Payments could not be loaded.', 'fair-events' )
				)
			);
		} finally {
			setPaymentsLoading( false );
		}
	};

	const loadAccounting = async () => {
		setAccountingLoading( true );
		setAccountingError( null );

		try {
			const [ totalsData, entriesData ] = await Promise.all( [
				apiFetch( {
					path: `/fair-finance/v1/financial-entries/totals?event_date_id=${ eventDateId }`,
				} ),
				apiFetch( {
					path: `/fair-finance/v1/financial-entries?event_date_id=${ eventDateId }&per_page=10&entry_type=cost`,
				} ),
			] );

			setAccounting( {
				totalCost: totalsData.total_cost || 0,
				costEntries: entriesData.entries || [],
			} );
		} catch ( err ) {
			setAccounting( null );
			setAccountingError(
				loadErrorMessage(
					err,
					__( 'Costs could not be loaded.', 'fair-events' )
				)
			);
		} finally {
			setAccountingLoading( false );
		}
	};

	const loadBudget = async () => {
		setBudgetLoading( true );
		setBudgetLoadError( null );

		try {
			const [ budgetsData, eventBudgetData ] = await Promise.all( [
				apiFetch( { path: '/fair-finance/v1/budgets' } ),
				apiFetch( {
					path: `/fair-events/v1/event-dates/${ eventDateId }/budget`,
				} ),
			] );

			setBudgets( budgetsData || [] );
			const currentBudgetId = eventBudgetData?.budget_id
				? String( eventBudgetData.budget_id )
				: '';
			setBudgetId( currentBudgetId );
			setSavedBudgetId( currentBudgetId );
		} catch ( err ) {
			setBudgetLoadError(
				loadErrorMessage(
					err,
					__( 'Budgets could not be loaded.', 'fair-events' )
				)
			);
		} finally {
			setBudgetLoading( false );
		}
	};

	const handleSaveBudget = async () => {
		setBudgetSaving( true );
		setBudgetError( null );
		setBudgetSuccess( null );

		try {
			const updated = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/budget`,
				method: 'PUT',
				data: { budget_id: budgetId ? parseInt( budgetId, 10 ) : null },
			} );
			const newBudgetId = updated.budget_id
				? String( updated.budget_id )
				: '';
			setBudgetId( newBudgetId );
			setSavedBudgetId( newBudgetId );
			setBudgetSuccess( __( 'Budget updated.', 'fair-events' ) );
		} catch ( err ) {
			setBudgetError(
				err.message || __( 'Failed to update budget.', 'fair-events' )
			);
		} finally {
			setBudgetSaving( false );
		}
	};

	const loading = paymentsLoading || accountingLoading;
	const paymentsEmpty =
		!! payments &&
		payments.paid.length === 0 &&
		payments.failed.length === 0;
	const costsEmpty =
		!! accounting &&
		accounting.costEntries.length === 0 &&
		! accounting.totalCost;

	let emptyMessage = null;
	if ( connectorActive && financeActive ) {
		if ( paymentsEmpty && costsEmpty ) {
			emptyMessage = __(
				'No financial entries for this event yet.',
				'fair-events'
			);
		}
	} else if ( connectorActive && paymentsEmpty ) {
		emptyMessage = __( 'No payments for this event yet.', 'fair-events' );
	} else if ( financeActive && costsEmpty ) {
		emptyMessage = __( 'No costs for this event yet.', 'fair-events' );
	}

	const viewAllUrl = `${ entriesUrl }&event_date_id=${ eventDateId }`;

	return (
		<>
			{ financeActive && (
				<Card>
					<CardHeader>
						<h2>{ __( 'Budget', 'fair-events' ) }</h2>
					</CardHeader>
					<CardBody>
						{ budgetLoadError && (
							<Notice status="error" isDismissible={ false }>
								{ budgetLoadError }
							</Notice>
						) }

						{ budgetError && (
							<Notice
								status="error"
								isDismissible
								onRemove={ () => setBudgetError( null ) }
							>
								{ budgetError }
							</Notice>
						) }

						{ budgetSuccess && (
							<Notice
								status="success"
								isDismissible
								onRemove={ () => setBudgetSuccess( null ) }
							>
								{ budgetSuccess }
							</Notice>
						) }

						<VStack spacing={ 4 }>
							<SelectControl
								label={ __( 'Budget', 'fair-events' ) }
								help={ __(
									'Reconciliation splits preselect this budget for payments linked to this event.',
									'fair-events'
								) }
								value={ budgetId }
								options={ [
									{
										label: __( 'No budget', 'fair-events' ),
										value: '',
									},
									...budgets.map( ( budget ) => ( {
										label: budget.name,
										value: String( budget.id ),
									} ) ),
								] }
								onChange={ setBudgetId }
								disabled={ budgetLoading || !! budgetLoadError }
							/>
							<HStack justify="flex-start">
								<Button
									variant="primary"
									onClick={ handleSaveBudget }
									isBusy={ budgetSaving }
									disabled={
										budgetSaving ||
										budgetLoading ||
										!! budgetLoadError ||
										budgetId === savedBudgetId
									}
								>
									{ __( 'Save budget', 'fair-events' ) }
								</Button>
							</HStack>
						</VStack>
					</CardBody>
				</Card>
			) }

			<Card style={ financeActive ? { marginTop: '16px' } : undefined }>
				<CardHeader>
					<h2>{ __( 'Finance', 'fair-events' ) }</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={ 4 }>
						{ loading && (
							<div
								style={ {
									textAlign: 'center',
									padding: '20px',
								} }
							>
								<Spinner />
							</div>
						) }

						{ paymentsError && (
							<Notice status="error" isDismissible={ false }>
								{ paymentsError }
							</Notice>
						) }

						{ accountingError && (
							<Notice status="error" isDismissible={ false }>
								{ accountingError }
							</Notice>
						) }

						{ ( accounting || payments ) && (
							<HStack justify="space-around" wrap>
								{ accounting && (
									<SummaryStat
										label={ __(
											'Total Costs',
											'fair-events'
										) }
										value={ formatAmount(
											accounting.totalCost
										) }
										color="#d63638"
									/>
								) }
								{ payments && (
									<SummaryStat
										label={ __(
											'Total Income',
											'fair-events'
										) }
										value={ formatAmount(
											payments.income
										) }
										color="#007017"
									/>
								) }
								{ payments && (
									<SummaryStat
										label={ __(
											'Total Net',
											'fair-events'
										) }
										value={
											formatAmount( payments.net ) +
											( payments.netComplete ? '' : '*' )
										}
										color="#007017"
										title={
											payments.netComplete
												? __(
														'Sum of online payments after Mollie and application fees.',
														'fair-events'
													)
												: __(
														'Sum of online payments after fees, excluding transactions whose fee data has not been recorded yet.',
														'fair-events'
													)
										}
									/>
								) }
								{ accounting && payments && (
									<SummaryStat
										label={ __( 'Balance', 'fair-events' ) }
										value={ formatAmount(
											payments.income -
												accounting.totalCost
										) }
										color={
											payments.income -
												accounting.totalCost >=
											0
												? '#007017'
												: '#d63638'
										}
									/>
								) }
							</HStack>
						) }

						{ accounting?.costEntries.length > 0 && (
							<div style={ { overflowX: 'auto' } }>
								<h3 style={ { marginBottom: '8px' } }>
									{ __( 'Costs', 'fair-events' ) }
								</h3>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>
												{ __( 'Date', 'fair-events' ) }
											</th>
											<th>
												{ __(
													'Amount',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Description',
													'fair-events'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ accounting.costEntries.map(
											( entry ) => (
												<tr key={ entry.id }>
													<td>
														{ entriesUrl ? (
															<a
																href={ `${ entriesUrl }&entry_id=${ entry.id }` }
																aria-label={ sprintf(
																	/* translators: 1: financial entry ID, 2: entry date */
																	__(
																		'Entry #%1$d, %2$s',
																		'fair-events'
																	),
																	entry.id,
																	entry.entry_date
																) }
															>
																{
																	entry.entry_date
																}
															</a>
														) : (
															entry.entry_date
														) }
													</td>
													<td>
														<strong
															style={ {
																color: '#d63638',
															} }
														>
															{ formatAmount(
																entry.amount
															) }
														</strong>
													</td>
													<td>
														{ entry.description || (
															<em>-</em>
														) }
													</td>
												</tr>
											)
										) }
									</tbody>
								</table>
							</div>
						) }

						{ payments?.paid.length > 0 && (
							<div style={ { overflowX: 'auto' } }>
								<h3 style={ { marginBottom: '8px' } }>
									{ __( 'Payments', 'fair-events' ) }
								</h3>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>
												{ __( 'Date', 'fair-events' ) }
											</th>
											<th>
												{ __(
													'Amount',
													'fair-events'
												) }
											</th>
											<th
												title={ __(
													'Amount paid minus Mollie and application fees.',
													'fair-events'
												) }
											>
												{ __(
													'Net received',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Description',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Participant',
													'fair-events'
												) }
											</th>
											{ financeActive && (
												<th>
													{ __(
														'Budget entry',
														'fair-events'
													) }
												</th>
											) }
										</tr>
									</thead>
									<tbody>
										{ payments.paid.map( ( tx ) => {
											const net =
												computeNetReceived( tx );
											return (
												<tr key={ tx.id }>
													<td>
														{ tx.created_at
															? tx.created_at.slice(
																	0,
																	10
																)
															: '-' }
													</td>
													<td>
														<a
															href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ tx.id }` }
														>
															<strong
																style={ {
																	color: '#007017',
																} }
															>
																{ formatAmount(
																	tx.amount
																) }
															</strong>
														</a>
													</td>
													<td>
														{ net === null ? (
															<em>-</em>
														) : (
															<strong
																style={ {
																	color: '#007017',
																} }
															>
																{ formatAmount(
																	net
																) }
															</strong>
														) }
													</td>
													<td>
														{ tx.description || (
															<em>-</em>
														) }
													</td>
													<td>
														{ renderParticipant(
															tx
														) }
													</td>
													{ financeActive && (
														<td>
															{ tx.entry_ids
																?.length
																? tx.entry_ids.map(
																		(
																			id,
																			index
																		) => (
																			<Fragment
																				key={
																					id
																				}
																			>
																				{ index >
																					0 &&
																					', ' }
																				{ entriesUrl ? (
																					<a
																						href={ `${ entriesUrl }&entry_id=${ id }` }
																					>
																						{ `#${ id }` }
																					</a>
																				) : (
																					`#${ id }`
																				) }
																			</Fragment>
																		)
																	)
																: '-' }
														</td>
													) }
												</tr>
											);
										} ) }
									</tbody>
								</table>
							</div>
						) }

						{ payments?.failed.length > 0 && (
							<div style={ { overflowX: 'auto' } }>
								<h3 style={ { marginBottom: '8px' } }>
									{ __( 'Failed Payments', 'fair-events' ) }
								</h3>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>
												{ __( 'Date', 'fair-events' ) }
											</th>
											<th>
												{ __(
													'Amount',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Status',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Description',
													'fair-events'
												) }
											</th>
											<th>
												{ __(
													'Participant',
													'fair-events'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ payments.failed.map( ( tx ) => (
											<tr key={ tx.id }>
												<td>
													{ tx.created_at
														? tx.created_at.slice(
																0,
																10
															)
														: '-' }
												</td>
												<td>
													<a
														href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ tx.id }` }
													>
														<strong
															style={ {
																color: '#d63638',
															} }
														>
															{ formatAmount(
																tx.amount
															) }
														</strong>
													</a>
												</td>
												<td>
													<span
														style={ {
															color: '#d63638',
															fontWeight: 'bold',
														} }
													>
														{ tx.status }
													</span>
												</td>
												<td>
													{ tx.description || (
														<em>-</em>
													) }
												</td>
												<td>
													{ renderParticipant( tx ) }
												</td>
											</tr>
										) ) }
									</tbody>
								</table>
							</div>
						) }

						{ ! loading && emptyMessage && (
							<p
								style={ {
									textAlign: 'center',
									color: '#666',
								} }
							>
								{ emptyMessage }
							</p>
						) }

						{ financeActive && entriesUrl && (
							<HStack justify="flex-start">
								<Button variant="secondary" href={ viewAllUrl }>
									{ __( 'View All Entries', 'fair-events' ) }
								</Button>
							</HStack>
						) }
					</VStack>
				</CardBody>
			</Card>
		</>
	);
}
