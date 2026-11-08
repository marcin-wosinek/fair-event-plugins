/**
 * Purchases card of the participant detail
 *
 * Once Fair Events' payment readers are active, the participant's payments
 * are the purchases they made as the purchaser, each with every payment
 * attempt from Fair Events' payment links (PAYMENT_HISTORY_MIGRATION.md
 * §8.15). Tickets the participant only holds belong to someone else's
 * purchase and aren't listed here.
 *
 * @package FairAudience
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { Card, CardBody, CardHeader, Notice } from '@wordpress/components';
import { formatTimingStart } from 'fair-events-shared/src/dateTime.js';

const PURCHASE_STATUS_DISPLAY = {
	confirmed: __( 'Confirmed', 'fair-audience' ),
	pending_payment: __( 'Awaiting payment', 'fair-audience' ),
	failed: __( 'Payment failed', 'fair-audience' ),
	expired: __( 'Expired', 'fair-audience' ),
	cancelled: __( 'Cancelled', 'fair-audience' ),
};

const PAYMENT_STATUS_DISPLAY = {
	success: { color: '#00a32a', label: __( 'Paid', 'fair-audience' ) },
	pending: { color: '#996800', label: __( 'Pending', 'fair-audience' ) },
	failed: { color: '#d63638', label: __( 'Failed', 'fair-audience' ) },
};

/**
 * What a payment pays for.
 *
 * @param {string} role Payment link role.
 * @return {string} Label
 */
export function purchasePaymentRoleLabel( role ) {
	switch ( role ) {
		case 'charge':
			return __( 'Tickets', 'fair-audience' );
		case 'additional_charge':
			return __( 'Added activities', 'fair-audience' );
		case 'upgrade':
			return __( 'Series upgrade', 'fair-audience' );
		case 'legacy_refund_record':
			return __( 'Refund record (not counted)', 'fair-audience' );
		default:
			return role;
	}
}

/**
 * Format an amount in its own currency.
 *
 * @param {number} amount   Amount.
 * @param {string} currency ISO currency code.
 * @return {string} Formatted amount
 */
function formatAmount( amount, currency ) {
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
 * One payment of a purchase: its transaction, what it was for, its status
 * and this purchase's share.
 *
 * @param {Object} props
 * @param {Object} props.payment Payment of the purchase.
 * @param {number} props.latest  The purchase's latest attempt.
 */
function PaymentLine( { payment, latest } ) {
	const status = PAYMENT_STATUS_DISPLAY[ payment.transaction_status ];
	return (
		<li>
			<a
				href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ payment.transaction_id }` }
			>
				{ `#${ payment.transaction_id }` }
			</a>{ ' ' }
			{ purchasePaymentRoleLabel( payment.role ) }
			{ ', ' }
			{ formatAmount( payment.allocated_amount, payment.currency ) }
			{ status && (
				<span
					style={ {
						marginLeft: '6px',
						color: status.color,
						fontWeight: 'bold',
					} }
				>
					{ status.label }
				</span>
			) }
			{ payment.transaction_missing && (
				<span style={ { marginLeft: '6px', fontStyle: 'italic' } }>
					{ __(
						'Missing in Fair Payments Connector',
						'fair-audience'
					) }
				</span>
			) }
			{ latest === payment.transaction_id && (
				<em style={ { marginLeft: '6px' } }>
					{ __( '(latest attempt)', 'fair-audience' ) }
				</em>
			) }
		</li>
	);
}

/**
 * The participant's purchases with their payments.
 *
 * @param {Object}   props
 * @param {Object[]} props.purchases          Purchases from the activity response.
 * @param {string}   props.paymentInformation 'available' or 'unavailable'.
 */
export default function ParticipantPurchases( {
	purchases,
	paymentInformation,
} ) {
	return (
		<Card className="fair-audience-participant-detail__card">
			<CardHeader>
				<h2>
					{ __( 'Purchases', 'fair-audience' ) } ({ purchases.length }
					)
				</h2>
			</CardHeader>
			<CardBody className="fair-audience-participant-detail__table">
				{ paymentInformation === 'unavailable' && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Payment statuses and amounts paid aren’t available because payment information can’t be read.',
							'fair-audience'
						) }
					</Notice>
				) }
				{ purchases.length === 0 ? (
					<p>
						{ __(
							'This participant hasn’t bought tickets.',
							'fair-audience'
						) }
					</p>
				) : (
					<table className="wp-list-table widefat striped">
						<thead>
							<tr>
								<th>{ __( 'Event', 'fair-audience' ) }</th>
								<th>{ __( 'Date', 'fair-audience' ) }</th>
								<th>{ __( 'Tickets', 'fair-audience' ) }</th>
								<th>{ __( 'Status', 'fair-audience' ) }</th>
								<th>{ __( 'Paid', 'fair-audience' ) }</th>
								<th>{ __( 'Payments', 'fair-audience' ) }</th>
							</tr>
						</thead>
						<tbody>
							{ purchases.map( ( purchase ) => (
								<tr key={ purchase.signup_id }>
									<td>
										{ purchase.event_date_id ? (
											<a
												href={ `admin.php?page=fair-events-manage-event&event_date_id=${ purchase.event_date_id }&tab=finance` }
											>
												{ purchase.event_title ||
													__(
														'(untitled)',
														'fair-audience'
													) }
											</a>
										) : (
											purchase.event_title || '—'
										) }
									</td>
									<td>
										{ formatTimingStart( purchase ) || '—' }
									</td>
									<td>
										{ sprintf(
											/* translators: 1: number of tickets, 2: ticket type name */
											_n(
												'%1$d × %2$s',
												'%1$d × %2$s',
												purchase.quantity,
												'fair-audience'
											),
											purchase.quantity,
											purchase.ticket_type_name ||
												__( 'Ticket', 'fair-audience' )
										) }
									</td>
									<td>
										{ PURCHASE_STATUS_DISPLAY[
											purchase.status
										] || purchase.status }
									</td>
									<td>
										{ null === purchase.paid_amount
											? '—'
											: formatAmount(
													purchase.paid_amount,
													purchase.paid_currency
												) }
									</td>
									<td>
										{ purchase.payments.length === 0 ? (
											__( 'None', 'fair-audience' )
										) : (
											<ul style={ { margin: 0 } }>
												{ purchase.payments.map(
													( payment ) => (
														<PaymentLine
															key={ `${ payment.transaction_id }-${ payment.role }` }
															payment={ payment }
															latest={
																purchase.latest_transaction_id
															}
														/>
													)
												) }
											</ul>
										) }
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) }
			</CardBody>
		</Card>
	);
}
