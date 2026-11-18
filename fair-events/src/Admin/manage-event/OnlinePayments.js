/**
 * Online payments of the Finance tab
 *
 * Collapsed on arrival. Opening it loads the date's live payments from
 * Fair Payments Connector: successful payments first, then failed, expired
 * and canceled attempts in their own, initially collapsed section. Totals
 * live in the event result above; this list is only the detail.
 *
 * @package FairEvents
 */

import { useState, Fragment } from '@wordpress/element';
import {
	Card,
	CardBody,
	Panel,
	PanelBody,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const PER_PAGE = 100;
const siteCurrency = () => window.fairPaymentsConnector?.currency || 'EUR';

const formatAmount = ( amount ) =>
	new Intl.NumberFormat( 'en-US', {
		style: 'currency',
		currency: siteCurrency(),
	} ).format( amount || 0 );

/**
 * Amount after recorded fees, or null when the Mollie fee isn't recorded.
 *
 * @param {Object} tx Transaction.
 * @return {number|null} Net amount.
 */
export const computeNetReceived = ( tx ) => {
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
 * Sentence-case label of an unsuccessful attempt's status.
 *
 * @param {string} status Connector status.
 * @return {string} Label.
 */
export function attemptStatusLabel( status ) {
	switch ( status ) {
		case 'failed':
			return __( 'Failed', 'fair-events' );
		case 'expired':
			return __( 'Expired', 'fair-events' );
		case 'canceled':
			return __( 'Canceled', 'fair-events' );
		default:
			return status || '—';
	}
}

const transactionUrl = ( id ) =>
	`admin.php?page=fair-payments-connector-transaction&transaction_id=${ id }`;

const day = ( tx ) => ( tx.created_at ? tx.created_at.slice( 0, 10 ) : '-' );

/**
 * Online payments section.
 *
 * @param {Object}  props
 * @param {number}  props.eventDateId   Event date being managed.
 * @param {boolean} props.financeActive Fair Finance is active (budget entry column).
 * @param {string}  props.entriesUrl    Fair Finance entries screen URL.
 * @return {Element} The section.
 */
export default function OnlinePayments( {
	eventDateId,
	financeActive = false,
	entriesUrl = '',
} ) {
	const [ payments, setPayments ] = useState( null );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState( null );

	const load = async () => {
		setLoading( true );
		setError( null );
		const fetchStatus = ( status ) =>
			apiFetch( {
				path: `/fair-payments-connector/v1/transactions?event_date_id=${ eventDateId }&status=${ status }&mode=live&per_page=${ PER_PAGE }`,
			} );
		try {
			const [ paidData, failedData, canceledData, expiredData ] =
				await Promise.all( [
					fetchStatus( 'paid' ),
					fetchStatus( 'failed' ),
					fetchStatus( 'canceled' ),
					fetchStatus( 'expired' ),
				] );
			const failed = [
				...( failedData.transactions || [] ),
				...( canceledData.transactions || [] ),
				...( expiredData.transactions || [] ),
			].sort( ( a, b ) =>
				( b.created_at || '' ).localeCompare( a.created_at || '' )
			);
			const paid = paidData.transactions || [];
			setPayments( {
				paid,
				paidTotal: paidData.total ?? paid.length,
				failed,
			} );
		} catch ( err ) {
			setError(
				err?.message
					? sprintf(
							/* translators: %s: error message from the server */
							__(
								'Payments could not be loaded. %s',
								'fair-events'
							),
							err.message
						)
					: __( 'Payments could not be loaded.', 'fair-events' )
			);
		} finally {
			setLoading( false );
		}
	};

	const handleToggle = ( opened ) => {
		if ( opened && ! payments && ! loading ) {
			// load() reports its own errors, so it never rejects.
			void load();
		}
	};

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardBody style={ { padding: 0 } }>
				<Panel>
					<PanelBody
						title={ __( 'Online payments', 'fair-events' ) }
						initialOpen={ false }
						onToggle={ handleToggle }
					>
						<VStack spacing={ 4 }>
							{ loading && <Spinner /> }

							{ error && (
								<Notice status="error" isDismissible={ false }>
									{ error }
								</Notice>
							) }

							{ payments && 0 === payments.paid.length && (
								<p style={ { margin: 0, color: '#666' } }>
									{ __(
										'No successful online payments for this event yet.',
										'fair-events'
									) }
								</p>
							) }

							{ payments?.paid.length > 0 && (
								<div style={ { overflowX: 'auto' } }>
									<table className="wp-list-table widefat striped">
										<caption className="screen-reader-text">
											{ __(
												'Successful payments',
												'fair-events'
											) }
										</caption>
										<thead>
											<tr>
												<th>
													{ __(
														'Date',
														'fair-events'
													) }
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
														<td>{ day( tx ) }</td>
														<td>
															<a
																href={ transactionUrl(
																	tx.id
																) }
															>
																<strong>
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
																formatAmount(
																	net
																)
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

							{ payments &&
								payments.paidTotal > payments.paid.length && (
									<p style={ { margin: 0, color: '#666' } }>
										{ sprintf(
											/* translators: 1: number of payments shown, 2: number of successful payments */
											__(
												'Showing the latest %1$d of %2$d successful payments. The event result above counts all of them.',
												'fair-events'
											),
											payments.paid.length,
											payments.paidTotal
										) }
									</p>
								) }

							{ payments && (
								<Panel>
									<PanelBody
										title={ sprintf(
											/* translators: %d: number of unsuccessful payment attempts */
											_n(
												'Failed, expired or canceled attempt (%d)',
												'Failed, expired or canceled attempts (%d)',
												payments.failed.length,
												'fair-events'
											),
											payments.failed.length
										) }
										initialOpen={ false }
									>
										<p style={ { marginTop: 0 } }>
											{ __(
												'These attempts brought in no money and aren’t counted in sales.',
												'fair-events'
											) }
										</p>
										{ payments.failed.length > 0 && (
											<div
												style={ { overflowX: 'auto' } }
											>
												<table className="wp-list-table widefat striped">
													<caption className="screen-reader-text">
														{ __(
															'Unsuccessful payment attempts',
															'fair-events'
														) }
													</caption>
													<thead>
														<tr>
															<th>
																{ __(
																	'Date',
																	'fair-events'
																) }
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
														{ payments.failed.map(
															( tx ) => (
																<tr
																	key={
																		tx.id
																	}
																>
																	<td>
																		{ day(
																			tx
																		) }
																	</td>
																	<td>
																		<a
																			href={ transactionUrl(
																				tx.id
																			) }
																		>
																			{ formatAmount(
																				tx.amount
																			) }
																		</a>
																	</td>
																	<td>
																		{ attemptStatusLabel(
																			tx.status
																		) }
																	</td>
																	<td>
																		{ tx.description || (
																			<em>
																				-
																			</em>
																		) }
																	</td>
																	<td>
																		{ renderParticipant(
																			tx
																		) }
																	</td>
																</tr>
															)
														) }
													</tbody>
												</table>
											</div>
										) }
									</PanelBody>
								</Panel>
							) }
						</VStack>
					</PanelBody>
				</Panel>
			</CardBody>
		</Card>
	);
}
