<?php
/**
 * Drive and inspect fair-events payment history shadow writes for
 * PaymentHistoryShadowWrites API coverage (#2139, stage 3 of #2111).
 *
 * Usage: wp eval-file .../payment-shadow-writes.php <action> <json>
 *
 * Every action that writes finishes the shadow work its writers queued
 * before printing, as the end of a web request would.
 *
 * Actions:
 *   coverage          {}  Coverage floors, the capabilities and backfill blockers.
 *   audience-signup   {eventId, eventDateId, ticketTypeId}  A new participant
 *                         buys through Fair Audience's own purchase route
 *                         (POST fair-audience/v1/event-signup), as a fresh
 *                         logged-in user.
 *   settle            {transactionId, status}  Connector reports the status
 *                         (paid or failed): every payment hook runs, as for a
 *                         webhook.
 *   sweep             {}  Run the shadow work cron once.
 *   state             {transactionIds?, relationshipIds?}  Links per transaction,
 *                         and each relationship with its shadow purchase, units,
 *                         activities and queued work.
 *   capacity          {eventDateId}  TicketCapacity's admission count.
 *   queue             {kind, sourceId}  Queue work and process it.
 *   cleanup           {transactionIds, relationshipIds, userIds}
 *
 * Prints one `E2E_PAYMENT_SHADOW:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryShadowWrites;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$links_table        = $wpdb->prefix . 'fair_events_signup_payment_links';
$signups_table      = $wpdb->prefix . 'fair_events_signups';
$tickets_table      = $wpdb->prefix . 'fair_events_tickets';
$activities_table   = $wpdb->prefix . 'fair_events_ticket_activities';
$relationship_table = $wpdb->prefix . 'fair_audience_event_participants';
$ledger_table       = $wpdb->prefix . 'fair_audience_event_participant_transactions';
$transactions_table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
$result             = array();

switch ( $fixture_action ) {
	case 'coverage':
		$result = array(
			'coverage'  => PaymentHistoryShadowWrites::coverage(),
			'supported' => PaymentHistoryCompatibility::shadow_writes_supported(),
			'covered'   => PaymentHistoryCompatibility::shadow_write_coverage(),
			'blockers'  => PaymentHistoryCompatibility::backfill_blockers(),
			'scheduled' => (bool) wp_next_scheduled( PaymentHistoryShadowWrites::CRON_HOOK ),
		);
		break;

	case 'audience-signup':
		$email   = 'shadow-' . wp_generate_password( 10, false ) . '@example.test';
		$user_id = wp_insert_user(
			array(
				'user_login' => sanitize_user( 'shadow_' . wp_generate_password( 8, false ) ),
				'user_email' => $email,
				'user_pass'  => wp_generate_password(),
				'first_name' => 'Shadow',
				'last_name'  => 'Buyer',
			)
		);
		if ( is_wp_error( $user_id ) ) {
			WP_CLI::error( $user_id->get_error_message() );
		}
		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_participants',
			array(
				'name'       => 'Shadow',
				'surname'    => 'Buyer',
				'email'      => $email,
				'wp_user_id' => (int) $user_id,
				'status'     => 'confirmed',
			)
		);
		wp_set_current_user( $user_id );

		$request = new WP_REST_Request( 'POST', '/fair-audience/v1/event-signup' );
		$request->set_body_params(
			array(
				'event_id'       => (int) $data['eventId'],
				'event_date_id'  => (int) $data['eventDateId'],
				'ticket_type_id' => (int) $data['ticketTypeId'],
				'email'          => $email,
			)
		);
		$response = rest_do_request( $request );
		PaymentHistoryShadowWrites::process_queued();

		$body            = $response->get_data();
		$transaction_id  = (int) ( $body['transaction_id'] ?? 0 );
		$relationship_id = $transaction_id ? (int) $wpdb->get_var( $wpdb->prepare( 'SELECT event_participant_id FROM %i WHERE transaction_id = %d', $ledger_table, $transaction_id ) ) : 0;
		$result          = array(
			'status'         => $response->get_status(),
			'body'           => $body,
			'userId'         => (int) $user_id,
			'transactionId'  => $transaction_id,
			'relationshipId' => $relationship_id,
			'participantId'  => $relationship_id ? (int) $wpdb->get_var( $wpdb->prepare( 'SELECT participant_id FROM %i WHERE id = %d', $relationship_table, $relationship_id ) ) : 0,
		);
		break;

	case 'settle':
		$settled_status = (string) $data['status'];
		$wpdb->update( $transactions_table, array( 'status' => $settled_status ), array( 'id' => (int) $data['transactionId'] ) );
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $data['transactionId'] );
		$payment     = (object) array(
			'id'     => 'tr_e2e_shadow',
			'status' => $settled_status,
		);
		do_action( 'paid' === $settled_status ? 'fair_payment_paid' : 'fair_payment_failed', $payment, $transaction );
		do_action( 'fair_payment_status_changed', $payment, $transaction );
		PaymentHistoryShadowWrites::process_queued();
		$result = array( 'status' => $settled_status );
		break;

	case 'sweep':
		$result = array(
			'swept' => PaymentHistoryShadowWrites::sweep(),
			'due'   => PaymentHistoryShadowWrites::process_due( 50 ),
		);
		break;

	case 'queue':
		PaymentShadowWork::enqueue( (string) $data['kind'], (int) $data['sourceId'] );
		$result = array(
			'outcome' => PaymentHistoryShadowWrites::process( (string) $data['kind'], (int) $data['sourceId'] ),
			'row'     => PaymentShadowWork::get( (string) $data['kind'], (int) $data['sourceId'] ),
		);
		break;

	case 'state':
		$result = array(
			'transactions'  => array(),
			'relationships' => array(),
		);
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$result['transactions'][ $transaction_id ] = array(
				'links' => array_map(
					static function ( $link ) {
						$link['evidence'] = json_decode( $link['evidence'], true );
						return $link;
					},
					(array) $wpdb->get_results( $wpdb->prepare( 'SELECT signup_id, role, allocated_amount, currency, attribution, evidence FROM %i WHERE transaction_id = %d ORDER BY id', $links_table, $transaction_id ), ARRAY_A )
				),
				'work'  => PaymentShadowWork::get( PaymentShadowWork::KIND_TRANSACTION, $transaction_id ),
			);
		}
		foreach ( array_map( 'intval', (array) ( $data['relationshipIds'] ?? array() ) ) as $relationship_id ) {
			$signup = $wpdb->get_row( $wpdb->prepare( 'SELECT id, event_date_id, ticket_type_id, status, amount, transaction_id, payment_expires_at, participant_id, name, email FROM %i WHERE legacy_event_participant_id = %d', $signups_table, $relationship_id ), ARRAY_A );
			$units  = $signup ? (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, status, event_date_id, ticket_type_id, holder_participant_id FROM %i WHERE signup_id = %d', $tickets_table, (int) $signup['id'] ), ARRAY_A ) : array();
			foreach ( $units as &$unit ) {
				$unit['activities'] = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT ticket_option_id, status FROM %i WHERE ticket_id = %d', $activities_table, (int) $unit['id'] ), ARRAY_A );
			}
			unset( $unit );
			$result['relationships'][ $relationship_id ] = array(
				'relationship' => $wpdb->get_row( $wpdb->prepare( 'SELECT id, label, payment_expires_at, ticket_type_id FROM %i WHERE id = %d', $relationship_table, $relationship_id ), ARRAY_A ),
				'purchase'     => $signup,
				'units'        => $units,
				'work'         => PaymentShadowWork::get( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_id ),
			);
		}
		break;

	case 'capacity':
		$result = array( 'taken' => \FairEvents\Services\TicketCapacity::count_event_date( (int) $data['eventDateId'] ) );
		break;

	case 'cleanup':
		foreach ( array_filter( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) ) as $transaction_id ) {
			$wpdb->delete( $links_table, array( 'transaction_id' => $transaction_id ) );
			$wpdb->delete(
				PaymentShadowWork::table(),
				array(
					'kind'      => PaymentShadowWork::KIND_TRANSACTION,
					'source_id' => $transaction_id,
				)
			);
		}
		foreach ( array_filter( array_map( 'intval', (array) ( $data['relationshipIds'] ?? array() ) ) ) as $relationship_id ) {
			$signup_id = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_event_participant_id = %d', $signups_table, $relationship_id ) );
			if ( $signup_id ) {
				$wpdb->delete( $links_table, array( 'signup_id' => $signup_id ) );
				\FairEvents\Models\EventTicket::delete_by_signup_id( $signup_id );
				$wpdb->delete( $signups_table, array( 'id' => $signup_id ) );
			}
			$wpdb->delete(
				PaymentShadowWork::table(),
				array(
					'kind'      => PaymentShadowWork::KIND_RELATIONSHIP,
					'source_id' => $relationship_id,
				)
			);
		}
		require_once ABSPATH . 'wp-admin/includes/user.php';
		foreach ( array_filter( array_map( 'intval', (array) ( $data['userIds'] ?? array() ) ) ) as $user_id ) {
			wp_delete_user( $user_id );
		}
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_PAYMENT_SHADOW:' . wp_json_encode( $result ) . "\n";
