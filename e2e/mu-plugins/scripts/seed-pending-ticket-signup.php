<?php
/**
 * Seed a stuck get-tickets signup + transaction pair for the E2E
 * return-and-retry specs (#1244).
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-pending-ticket-signup.php <eventDateId> <price> [status] [checkoutUrl]
 *
 * The get-tickets base form is anonymous — there is no participant to attach
 * this to (unlike fair-audience's seed-pending-signup.php). This creates:
 *   - a fair_payment_transactions row in the given status (default 'failed',
 *     one of the states SignupPaymentState treats as retriable), with a
 *     synthetic access_token so the callback URL / retry-payment route can
 *     verify ownership exactly as a real signup would produce;
 *   - a fair_events_signups row with status 'pending_payment' and a
 *     payment_expires_at an hour out (within the hold window), linked to the
 *     transaction via EventSignup::update_transaction().
 *
 * Prints a single `E2E_PENDING_TICKET:{json}` line with the signup id,
 * transaction id, access token, and buyer email.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\EventSignup;
use FairPaymentsConnector\Models\Transaction;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
$price         = isset( $args[1] ) ? (float) $args[1] : 0.0;
$tx_status     = isset( $args[2] ) && '' !== $args[2] ? (string) $args[2] : 'failed';
$checkout_url  = isset( $args[3] ) ? (string) $args[3] : '';

if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: seed-pending-ticket-signup.php <eventDateId> <price> [status] [checkoutUrl]' );
}

$stamp = gmdate( 'YmdHis' ) . '-' . wp_rand( 1000, 9999 );
$email = 'pending.ticket.' . $stamp . '@example.test';

$transaction_id = Transaction::create(
	array(
		'mollie_payment_id' => 'tr_e2e_ticket_' . $stamp,
		'event_date_id'     => $event_date_id,
		'amount'            => $price,
		'status'            => $tx_status,
		'checkout_url'      => $checkout_url,
		'description'       => 'E2E pending ticket signup',
		'access_token'      => wp_generate_password( 32, false ),
		'metadata'          => wp_json_encode(
			array(
				'source'        => 'fair-events-get-tickets',
				'event_date_id' => $event_date_id,
			)
		),
	)
);
if ( ! $transaction_id ) {
	WP_CLI::error( 'Failed to create transaction.' );
}

$signup_id = EventSignup::save(
	array(
		'event_date_id' => $event_date_id,
		'name'          => 'E2E Pending Ticket Buyer ' . $stamp,
		'email'         => $email,
		'quantity'      => 1,
		'amount'        => $price,
		'status'        => 'pending_payment',
	)
);
if ( ! $signup_id ) {
	WP_CLI::error( 'Failed to create signup row.' );
}
EventSignup::update_transaction( $signup_id, (int) $transaction_id );

$transaction = Transaction::get_by_id( $transaction_id );

echo 'E2E_PENDING_TICKET:' . wp_json_encode(
	array(
		'signupId'      => (int) $signup_id,
		'transactionId' => (int) $transaction_id,
		'token'         => (string) $transaction->access_token,
		'email'         => $email,
	)
) . "\n";
