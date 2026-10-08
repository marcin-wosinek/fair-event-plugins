<?php
/**
 * Report who owns each get-tickets signup of an event date, for the
 * register-another-person E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/signup-ownership-state.php <event_date_id>
 *
 * Prints a single `E2E_OWNERSHIP:{json}` line with one entry per
 * fair_events_signups row: its email and status, the participant it is linked
 * to (ID and email), the participant its tickets were bought by, and — when a
 * transaction is attached — that transaction's status and participant.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

global $wpdb;

$event_date_id = isset( $args[0] ) ? (int) $args[0] : 0;
if ( ! $event_date_id ) {
	WP_CLI::error( 'Usage: signup-ownership-state.php <event_date_id>' );
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off state dump for the spec, no cache to honour.
$rows = $wpdb->get_results(
	$wpdb->prepare( 'SELECT * FROM %i WHERE event_date_id = %d ORDER BY id ASC', $wpdb->prefix . 'fair_events_signups', $event_date_id )
);

$signups = array();
foreach ( $rows as $row ) {
	$participant_email = $row->participant_id
		? $wpdb->get_var(
			$wpdb->prepare( 'SELECT email FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_participants', (int) $row->participant_id )
		)
		: null;

	$purchaser_ids = $wpdb->get_col(
		$wpdb->prepare( 'SELECT DISTINCT purchaser_participant_id FROM %i WHERE signup_id = %d', $wpdb->prefix . 'fair_events_tickets', (int) $row->id )
	);

	$transaction = $row->transaction_id
		? $wpdb->get_row(
			$wpdb->prepare( 'SELECT status, participant_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_payment_transactions', (int) $row->transaction_id )
		)
		: null;

	$signups[] = array(
		'id'                         => (int) $row->id,
		'email'                      => (string) $row->email,
		'status'                     => (string) $row->status,
		'participant_id'             => $row->participant_id ? (int) $row->participant_id : null,
		'participant_email'          => $participant_email,
		'ticket_purchaser_ids'       => array_map( 'intval', array_filter( $purchaser_ids ) ),
		'transaction_id'             => $row->transaction_id ? (int) $row->transaction_id : null,
		'transaction_status'         => $transaction ? (string) $transaction->status : null,
		'transaction_participant_id' => $transaction && $transaction->participant_id ? (int) $transaction->participant_id : null,
	);
}
// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

echo 'E2E_OWNERSHIP:' . wp_json_encode( array( 'signups' => $signups ) ) . "\n";
