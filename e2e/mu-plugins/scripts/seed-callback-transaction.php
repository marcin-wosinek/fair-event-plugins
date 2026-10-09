<?php
/**
 * Seed a synthetic transaction for the payment-callback E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-callback-transaction.php <status>
 *
 * The callback script only reads the stored row through the token-gated
 * status route, so no Mollie request is involved: the row is created directly
 * in the requested status with a known access token.
 *
 * Prints a single `E2E_CALLBACK_TX:{json}` line with the transaction id, its
 * access token, and the amount/currency the notification text carries.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

use FairPaymentsConnector\Models\Transaction;

$callback_status = isset( $args[0] ) ? (string) $args[0] : 'paid';

$allowed = array( 'paid', 'pending_payment', 'failed', 'expired', 'canceled', 'draft' );
if ( ! in_array( $callback_status, $allowed, true ) ) {
	WP_CLI::error( 'Usage: seed-callback-transaction.php <' . implode( '|', $allowed ) . '>' );
}

$access_token   = wp_generate_password( 32, false );
$transaction_id = Transaction::create(
	array(
		'mollie_payment_id' => 'tr_e2e_callback_' . wp_rand( 100000, 999999 ),
		'user_id'           => 0,
		'amount'            => 12.50,
		'status'            => $callback_status,
		'description'       => 'E2E payment callback ' . $callback_status,
		'access_token'      => $access_token,
	)
);

if ( ! $transaction_id ) {
	WP_CLI::error( 'Could not create the callback transaction fixture.' );
}

$transaction = Transaction::get_by_id( $transaction_id );

echo 'E2E_CALLBACK_TX:' . wp_json_encode(
	array(
		'transactionId' => (int) $transaction_id,
		'token'         => $access_token,
		'status'        => $callback_status,
		'amount'        => (string) $transaction->amount,
		'currency'      => (string) $transaction->currency,
	)
) . "\n";
