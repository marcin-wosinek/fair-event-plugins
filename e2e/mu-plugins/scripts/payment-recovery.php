<?php
/**
 * Drive and inspect fair-events purchase recovery for PurchaseRecovery API
 * coverage (#2253): payment links written by checkouts themselves,
 * organizer changes to Fair Audience registrations followed at the end of
 * their request, and queued work finished by the recovery cron.
 *
 * Usage: wp eval-file .../payment-recovery.php <action> <json>
 *
 * Every action that writes finishes the work its writers queued before
 * printing, as the end of a web request would.
 *
 * Actions:
 *   upgrade           {}  Schedule the retired shadow work event, leave a
 *                         pending lifecycle row and a pending relationship
 *                         row in the queue, and run the 3.55.0 upgrade.
 *                         Reports both schedules and the rows before and
 *                         after, then removes the rows.
 *   audience-signup   {eventId, eventDateId, ticketTypeId}  A new participant
 *                         buys through Fair Audience's own purchase route
 *                         (POST fair-audience/v1/event-signup), as a fresh
 *                         logged-in user.
 *   settle            {transactionId, status}  Connector reports the status
 *                         (paid or failed): every payment hook runs, as for a
 *                         webhook.
 *   interrupt         {relationshipId, label}  An organizer's relabel whose
 *                         request died before the end: the label is written
 *                         and the relationship queued, but nothing is
 *                         processed.
 *   due               {}  Make every queued row due and run the recovery
 *                         cron once. Counts confirmation announcements.
 *   queue             {kind, sourceId}  Queue work and process it, as the
 *                         retired shadow writer left it.
 *   state             {transactionIds?, relationshipIds?}  Links per
 *                         transaction, and each relationship with its
 *                         purchases, units and queued work.
 *   capacity          {eventDateId}  TicketCapacity's admission count.
 *   cleanup           {transactionIds, relationshipIds, userIds}
 *
 * Prints one `E2E_PURCHASE_RECOVERY:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PurchaseRecovery;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$retired_hook       = 'fair_events_payment_history_shadow_work';
$links_table        = $wpdb->prefix . 'fair_events_signup_payment_links';
$signups_table      = $wpdb->prefix . 'fair_events_signups';
$tickets_table      = $wpdb->prefix . 'fair_events_tickets';
$relationship_table = $wpdb->prefix . 'fair_audience_event_participants';
$transactions_table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
$result             = array();

switch ( $fixture_action ) {
	case 'upgrade':
		// Source IDs no real row uses, so the rows can't touch other data.
		$lifecycle_source    = 2000000001;
		$relationship_source = 2000000002;
		wp_clear_scheduled_hook( $retired_hook );
		wp_schedule_event( time() + HOUR_IN_SECONDS, PurchaseRecovery::CRON_SCHEDULE, $retired_hook );
		PaymentShadowWork::enqueue_later( PaymentShadowWork::KIND_CONFIRMATION, $lifecycle_source, HOUR_IN_SECONDS );
		PaymentShadowWork::enqueue_later( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_source, HOUR_IN_SECONDS );

		$snapshot = static function () use ( $retired_hook, $lifecycle_source, $relationship_source ) {
			return array(
				'version'      => \FairEvents\Database\Schema::get_db_version(),
				'retired'      => (bool) wp_next_scheduled( $retired_hook ),
				'recovery'     => (bool) wp_next_scheduled( PurchaseRecovery::CRON_HOOK ),
				'lifecycle'    => null !== PaymentShadowWork::get( PaymentShadowWork::KIND_CONFIRMATION, $lifecycle_source ),
				'relationship' => null !== PaymentShadowWork::get( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_source ),
			);
		};

		$current = \FairEvents\Database\Schema::get_db_version();
		update_option( 'fair_events_db_version', '3.54.0' );
		$before = $snapshot();
		\FairEvents\Database\Installer::maybe_upgrade();
		$after = $snapshot();
		// A later request schedules the recovery cron on init.
		PurchaseRecovery::maybe_schedule();
		$after['recoveryAfterInit'] = (bool) wp_next_scheduled( PurchaseRecovery::CRON_HOOK );

		PaymentShadowWork::complete( PaymentShadowWork::KIND_CONFIRMATION, $lifecycle_source );
		PaymentShadowWork::complete( PaymentShadowWork::KIND_RELATIONSHIP, $relationship_source );
		if ( version_compare( \FairEvents\Database\Schema::get_db_version(), $current, '<' ) ) {
			update_option( 'fair_events_db_version', $current );
		}

		$result = array(
			'before' => $before,
			'after'  => $after,
		);
		break;

	case 'audience-signup':
		$email   = 'recovery-' . wp_generate_password( 10, false ) . '@example.test';
		$user_id = wp_insert_user(
			array(
				'user_login' => sanitize_user( 'recovery_' . wp_generate_password( 8, false ) ),
				'user_email' => $email,
				'user_pass'  => wp_generate_password(),
				'first_name' => 'Recovery',
				'last_name'  => 'Buyer',
			)
		);
		if ( is_wp_error( $user_id ) ) {
			WP_CLI::error( $user_id->get_error_message() );
		}
		$wpdb->insert(
			$wpdb->prefix . 'fair_audience_participants',
			array(
				'name'       => 'Recovery',
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
		PurchaseRecovery::process_queued();

		$body           = $response->get_data();
		$transaction_id = (int) ( $body['transaction_id'] ?? 0 );
		// The registration the checkout names in its own metadata.
		$metadata        = $transaction_id ? json_decode( (string) $wpdb->get_var( $wpdb->prepare( 'SELECT metadata FROM %i WHERE id = %d', $transactions_table, $transaction_id ) ), true ) : array();
		$relationship_id = (int) ( $metadata['event_participant_id'] ?? ( $metadata['event_participant_ids'][0] ?? 0 ) );
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
			'id'     => 'tr_e2e_recovery',
			'status' => $settled_status,
		);
		do_action( 'paid' === $settled_status ? 'fair_payment_paid' : 'fair_payment_failed', $payment, $transaction );
		do_action( 'fair_payment_status_changed', $payment, $transaction );
		PurchaseRecovery::process_queued();
		$result = array( 'status' => $settled_status );
		break;

	case 'interrupt':
		$wpdb->update( $relationship_table, array( 'label' => sanitize_key( (string) $data['label'] ) ), array( 'id' => (int) $data['relationshipId'] ) );
		PaymentShadowWork::enqueue( PaymentShadowWork::KIND_RELATIONSHIP, (int) $data['relationshipId'] );
		$result = array( 'row' => PaymentShadowWork::get( PaymentShadowWork::KIND_RELATIONSHIP, (int) $data['relationshipId'] ) );
		break;

	case 'due':
		$confirmed = 0;
		add_action(
			'fair_events_signup_confirmed',
			static function () use ( &$confirmed ) {
				++$confirmed;
			}
		);
		$wpdb->query( $wpdb->prepare( 'UPDATE %i SET next_attempt_at = %s', PaymentShadowWork::table(), gmdate( 'Y-m-d H:i:s', time() - 1 ) ) );
		$result = array(
			'processed' => PurchaseRecovery::process_due( 50 ),
			'confirmed' => $confirmed,
		);
		break;

	case 'queue':
		PaymentShadowWork::enqueue( (string) $data['kind'], (int) $data['sourceId'] );
		$result = array(
			'outcome' => PurchaseRecovery::process( (string) $data['kind'], (int) $data['sourceId'] ),
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
			$purchases                                   = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, event_date_id, ticket_type_id, status, amount, transaction_id, payment_expires_at, participant_id, name, email FROM %i WHERE legacy_event_participant_id = %d ORDER BY id', $signups_table, $relationship_id ), ARRAY_A );
			$signup                                      = $purchases ? $purchases[0] : null;
			$units                                       = $signup ? (array) $wpdb->get_results( $wpdb->prepare( 'SELECT id, status, event_date_id, ticket_type_id, holder_participant_id FROM %i WHERE signup_id = %d', $tickets_table, (int) $signup['id'] ), ARRAY_A ) : array();
			$result['relationships'][ $relationship_id ] = array(
				'relationship' => $wpdb->get_row( $wpdb->prepare( 'SELECT id, label, payment_expires_at, ticket_type_id FROM %i WHERE id = %d', $relationship_table, $relationship_id ), ARRAY_A ),
				'purchase'     => $signup,
				'purchases'    => count( $purchases ),
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
			foreach ( array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT id FROM %i WHERE legacy_event_participant_id = %d', $signups_table, $relationship_id ) ) ) as $signup_id ) {
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

echo 'E2E_PURCHASE_RECOVERY:' . wp_json_encode( $result ) . "\n";
