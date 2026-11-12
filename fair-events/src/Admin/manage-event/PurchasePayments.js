/**
 * Purchase payments section of the Finance tab
 *
 * Every payment attempt of the purchases listed for this date, read from
 * Fair Events' payment links once the Events readers are active
 * (PAYMENT_HISTORY_MIGRATION.md §8.15). The general payments list above it
 * still follows each transaction's editable event; this section follows
 * the purchases, and shows each purchase's own share of a shared payment.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { signupFullName } from './signup-name.js';

/**
 * What a payment link pays for.
 *
 * @param {string} role Link role.
 * @return {string} Label
 */
export function paymentRoleLabel( role ) {
	switch ( role ) {
		case 'charge':
			return __( 'Tickets', 'fair-events' );
		case 'additional_charge':
			return __( 'Added activities', 'fair-events' );
		case 'upgrade':
			return __( 'Series upgrade', 'fair-events' );
		case 'legacy_refund_record':
			return __( 'Refund record', 'fair-events' );
		default:
			return role;
	}
}

/**
 * A transaction's status as Connector has it now.
 *
 * @param {Object} payment Payment from the purchase's history.
 * @return {string} Label
 */
export function paymentStatusLabel( payment ) {
	if ( payment.transaction_missing ) {
		return __( 'Missing in Fair Payments Connector', 'fair-events' );
	}
	switch ( payment.transaction?.status ) {
		case 'paid':
			return __( 'Paid', 'fair-events' );
		case 'open':
		case 'pending':
		case 'draft':
			return __( 'Awaiting payment', 'fair-events' );
		case 'failed':
			return __( 'Failed', 'fair-events' );
		case 'canceled':
			return __( 'Canceled', 'fair-events' );
		case 'expired':
			return __( 'Expired', 'fair-events' );
		default:
			return payment.transaction?.status || '—';
	}
}

/**
 * Whether a payment's share counts as revenue, in words.
 *
 * @param {Object} payment Payment from the purchase's history.
 * @return {string} Label
 */
export function paymentCountsLabel( payment ) {
	if ( payment.role === 'legacy_refund_record' ) {
		return __( 'Not counted: refund record', 'fair-events' );
	}
	return payment.counts_as_revenue
		? __( 'Counted', 'fair-events' )
		: __( 'Not counted: not paid', 'fair-events' );
}

/**
 * Format an amount in its own currency.
 *
 * @param {number} amount   Amount.
 * @param {string} currency ISO currency code.
 * @return {string} Formatted amount
 */
export function formatPaymentAmount( amount, currency ) {
	try {
		return new Intl.NumberFormat( undefined, {
			style: 'currency',
			currency: currency || 'EUR',
		} ).format( amount );
	} catch {
		return `${ Number( amount ).toFixed( 2 ) } ${ currency }`;
	}
}

/**
 * One row per payment of each purchase that has any, newest purchase
 * first, each purchase's payments oldest first.
 *
 * @param {Object[]} signups Purchases from GET get-tickets.
 * @return {Object[]} Rows: { signup, payment }
 */
export function purchasePaymentRows( signups ) {
	return ( signups || [] ).flatMap( ( signup ) =>
		( signup.payment_history?.payments || [] ).map( ( payment ) => ( {
			signup,
			payment,
		} ) )
	);
}

/**
 * Purchase payments of one date.
 *
 * @param {Object} props
 * @param {number} props.eventDateId Event date being managed.
 */
export default function PurchasePayments( { eventDateId } ) {
	const [ signups, setSignups ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		let cancelled = false;
		setLoading( true );
		setError( null );
		apiFetch( {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} )
			.then( ( data ) => {
				if ( ! cancelled ) {
					setSignups( Array.isArray( data ) ? data : [] );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setSignups( null );
					setError(
						err?.message
							? sprintf(
									/* translators: %s: error message from the server */
									__(
										'Purchase payments could not be loaded. %s',
										'fair-events'
									),
									err.message
								)
							: __(
									'Purchase payments could not be loaded.',
									'fair-events'
								)
					);
				}
			} )
			.finally( () => {
				if ( ! cancelled ) {
					setLoading( false );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ eventDateId ] );

	const rows = purchasePaymentRows( signups );
	const unavailable = ( signups || [] ).some(
		( signup ) =>
			signup.payment_history?.payment_information === 'unavailable'
	);

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>{ __( 'Purchase payments', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					<p style={ { margin: 0 } }>
						{ __(
							'Every payment attempt of the purchases listed for this date, from Fair Events records. A payment shared by several purchases shows only this purchase’s share.',
							'fair-events'
						) }
					</p>

					{ loading && <Spinner /> }

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }

					{ ! loading && unavailable && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Payment statuses and totals aren’t available because payment information can’t be read.',
								'fair-events'
							) }
						</Notice>
					) }

					{ ! loading && ! error && rows.length === 0 && (
						<p style={ { margin: 0, color: '#666' } }>
							{ __(
								'No purchase on this date has a payment.',
								'fair-events'
							) }
						</p>
					) }

					{ rows.length > 0 && (
						<div style={ { overflowX: 'auto' } }>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>
											{ __( 'Purchase', 'fair-events' ) }
										</th>
										<th>
											{ __( 'Payment', 'fair-events' ) }
										</th>
										<th>{ __( 'For', 'fair-events' ) }</th>
										<th>
											{ __( 'Started', 'fair-events' ) }
										</th>
										<th>
											{ __( 'Status', 'fair-events' ) }
										</th>
										<th>
											{ __(
												'This purchase’s share',
												'fair-events'
											) }
										</th>
										<th>
											{ __( 'Revenue', 'fair-events' ) }
										</th>
									</tr>
								</thead>
								<tbody>
									{ rows.map( ( { signup, payment } ) => (
										<tr
											key={ `${ signup.id }-${ payment.transaction_id }-${ payment.role }` }
										>
											<td>
												{ signupFullName( signup ) ||
													sprintf(
														/* translators: %d: purchase ID */
														__(
															'Purchase #%d',
															'fair-events'
														),
														signup.id
													) }
											</td>
											<td>
												<a
													href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ payment.transaction_id }` }
												>
													{ `#${ payment.transaction_id }` }
												</a>
												{ payment.latest && (
													<>
														{ ' ' }
														<em>
															{ __(
																'(latest attempt)',
																'fair-events'
															) }
														</em>
													</>
												) }
											</td>
											<td>
												{ paymentRoleLabel(
													payment.role
												) }
											</td>
											<td>
												{ payment.created_at
													? payment.created_at.slice(
															0,
															10
														)
													: '—' }
											</td>
											<td>
												{ paymentStatusLabel(
													payment
												) }
											</td>
											<td>
												{ formatPaymentAmount(
													payment.allocated_amount,
													payment.currency
												) }
												{ payment.transaction &&
													payment.transaction
														.amount !==
														payment.allocated_amount && (
														<div
															style={ {
																color: '#666',
															} }
														>
															{ sprintf(
																/* translators: %s: total amount of the payment */
																__(
																	'of %s',
																	'fair-events'
																),
																formatPaymentAmount(
																	payment
																		.transaction
																		.amount,
																	payment
																		.transaction
																		.currency
																)
															) }
														</div>
													) }
											</td>
											<td>
												{ paymentCountsLabel(
													payment
												) }
											</td>
										</tr>
									) ) }
								</tbody>
							</table>
						</div>
					) }
				</VStack>
			</CardBody>
		</Card>
	);
}
