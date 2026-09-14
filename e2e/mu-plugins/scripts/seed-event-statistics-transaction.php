<?php
/**
 * Seed a payment-ledger row for EventStatistics API coverage.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test fixture updates an exact ledger row.
 */

defined( 'ABSPATH' ) || exit;

use FairAudience\Database\EventParticipantTransactionRepository;
use FairPaymentsConnector\Models\Transaction;

$relationship_id    = isset( $args[0] ) ? (int) $args[0] : 0;
$amount             = isset( $args[1] ) ? (float) $args[1] : 0.0;
$currency           = isset( $args[2] ) ? (string) $args[2] : 'EUR';
$transaction_status = isset( $args[3] ) ? (string) $args[3] : 'paid';
$kind               = isset( $args[4] ) ? (string) $args[4] : 'charge';
$created_at         = isset( $args[5] ) ? (string) $args[5] : current_time( 'mysql' );
$transaction_id     = isset( $args[6] ) ? (int) $args[6] : 0;

if ( ! $relationship_id ) {
	WP_CLI::error( 'A relationship ID is required.' );
}

if ( ! $transaction_id ) {
	$transaction_id = Transaction::create(
		array(
			'mollie_payment_id' => 'tr_statistics_' . wp_generate_uuid4(),
			'amount'            => $amount,
			'currency'          => $currency,
			'status'            => $transaction_status,
			'description'       => 'Event statistics fixture',
		)
	);
}

( new EventParticipantTransactionRepository() )->record( $relationship_id, $transaction_id, $kind );

global $wpdb;
$wpdb->update(
	$wpdb->prefix . 'fair_audience_event_participant_transactions',
	array( 'created_at' => $created_at ),
	array(
		'event_participant_id' => $relationship_id,
		'transaction_id'       => $transaction_id,
		'kind'                 => $kind,
	),
	array( '%s' ),
	array( '%d', '%d', '%s' )
);

echo 'E2E_EVENT_STATISTICS_TRANSACTION:' . wp_json_encode( array( 'transactionId' => (int) $transaction_id ) ) . "\n";
