<?php
/**
 * Prepare and inspect the payment history cutover activation for the
 * PaymentHistoryCutover API coverage (#2140, stage 4 of #2111).
 *
 * Usage: wp eval-file .../payment-cutover.php <action> <json>
 *
 * Actions:
 *   prepare   {}  Stash the migration's state, the activation, blocking
 *                 comparisons and queued shadow work, then record a
 *                 verified backfill with nothing outstanding, so only the
 *                 site's capabilities decide readiness. Prints the facts.
 *   status    {status}  Set the backfill's (and migration's) status, as a
 *                 later verification would.
 *   queue     {}  Queue one shadow work row (`shadow_work_outstanding`).
 *   block     {}  Store a blocking comparison for a date that doesn't
 *                 exist, which only the activation's recheck finds.
 *   unblock   {}  Remove what queue and block added.
 *   facts     {}  The activation facts, blockers and stored activation.
 *   audit     {}  Activation audit records written since prepare.
 *   restore   {}  Put everything prepare stashed back, and remove the
 *                 activation and its audit records.
 *
 * Prints one `E2E_PAYMENT_CUTOVER:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryAudit;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryCutover;
use FairEvents\Services\PaymentHistoryVerification;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$saved_option   = 'fair_e2e_payment_cutover_saved';
$fake_date_id   = 999999001;
$fake_source_id = 999999001;
$result         = array();

switch ( $fixture_action ) {
	case 'prepare':
		if ( false === get_option( $saved_option, false ) ) {
			$blocking = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i WHERE blocking = 1', PaymentHistoryVerification::table() ), ARRAY_A );
			$work     = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM %i', PaymentShadowWork::table() ), ARRAY_A );
			update_option(
				$saved_option,
				array(
					'state'         => get_option( PaymentHistoryCompatibility::STATE_OPTION, null ),
					'cutover'       => get_option( PaymentHistoryCompatibility::CUTOVER_OPTION, null ),
					'comparisons'   => $blocking,
					'work'          => $work,
					'last_audit_id' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COALESCE(MAX(id), 0) FROM %i', PaymentHistoryAudit::table() ) ),
				),
				false
			);
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE blocking = 1', PaymentHistoryVerification::table() ) );
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentShadowWork::table() ) );
		}
		delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );

		$now               = gmdate( 'Y-m-d H:i:s' );
		$state             = PaymentHistoryCompatibility::get_state();
		$state['status']   = 'verified';
		$state['backfill'] = array(
			'status'       => 'verified',
			'phase'        => 'summary',
			'cursor'       => 0,
			// No transaction is the backfill's, so the unlisted-payment
			// check only looks at what this spec adds.
			'cutoffs'      => array(
				'transaction_id'  => 0,
				'relationship_id' => 0,
			),
			'counts'       => array(),
			'totals'       => array(),
			'failures'     => 0,
			'last_error'   => null,
			'blockers'     => array(),
			'verification' => array(
				'checked_at'  => $now,
				'blockers'    => array(),
				'comparisons' => PaymentHistoryVerification::summary(),
			),
			'started_at'   => $now,
			'updated_at'   => $now,
			'completed_at' => $now,
		);
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );

		$facts  = PaymentHistoryCutover::facts();
		$result = array(
			'facts'    => $facts,
			'blockers' => PaymentHistoryCutover::blockers( $facts ),
		);
		break;

	case 'status':
		$state             = PaymentHistoryCompatibility::get_state();
		$state['status']   = sanitize_key( (string) $data['status'] );
		$state['backfill'] = array_merge( (array) ( $state['backfill'] ?? array() ), array( 'status' => $state['status'] ) );
		update_option( PaymentHistoryCompatibility::STATE_OPTION, $state, false );
		$result = array(
			'verified' => PaymentHistoryCompatibility::migration_verified(),
			'cutover'  => PaymentHistoryCompatibility::ownership_cutover(),
		);
		break;

	case 'queue':
		PaymentShadowWork::enqueue( PaymentShadowWork::KIND_TRANSACTION, $fake_source_id );
		$result = array( 'work' => PaymentShadowWork::count_outstanding() );
		break;

	case 'block':
		$wpdb->replace(
			PaymentHistoryVerification::table(),
			array(
				'event_date_id' => $fake_date_id,
				'admissions'    => '{}',
				'activities'    => '{}',
				'revenue'       => '{}',
				'revenue_state' => 'available',
				'blocking'      => 1,
				'checked_at'    => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		$result = array( 'blocked' => $fake_date_id );
		break;

	case 'unblock':
		PaymentShadowWork::complete( PaymentShadowWork::KIND_TRANSACTION, $fake_source_id );
		$wpdb->delete( PaymentHistoryVerification::table(), array( 'event_date_id' => $fake_date_id ) );
		$result = array( 'work' => PaymentShadowWork::count_outstanding() );
		break;

	case 'facts':
		$facts  = PaymentHistoryCutover::facts();
		$result = array(
			'facts'      => $facts,
			'blockers'   => PaymentHistoryCutover::blockers( $facts ),
			'activation' => get_option( PaymentHistoryCompatibility::CUTOVER_OPTION, null ),
			'cutover'    => PaymentHistoryCompatibility::ownership_cutover(),
		);
		break;

	case 'audit':
		$saved  = get_option( $saved_option, array() );
		$result = array(
			'records' => (array) $wpdb->get_results(
				$wpdb->prepare(
					'SELECT id, action, reason, user_id, after_state FROM %i WHERE id > %d AND action = %s ORDER BY id',
					PaymentHistoryAudit::table(),
					(int) ( $saved['last_audit_id'] ?? 0 ),
					PaymentHistoryAudit::ACTION_ACTIVATE
				),
				ARRAY_A
			),
		);
		break;

	case 'restore':
		$saved = get_option( $saved_option, false );
		if ( is_array( $saved ) ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE id > %d AND action = %s', PaymentHistoryAudit::table(), (int) $saved['last_audit_id'], PaymentHistoryAudit::ACTION_ACTIVATE ) );
			$wpdb->query( $wpdb->prepare( 'DELETE FROM %i', PaymentShadowWork::table() ) );
			foreach ( (array) $saved['work'] as $row ) {
				$wpdb->insert( PaymentShadowWork::table(), $row );
			}
			$wpdb->delete( PaymentHistoryVerification::table(), array( 'event_date_id' => $fake_date_id ) );
			foreach ( (array) $saved['comparisons'] as $row ) {
				$wpdb->replace( PaymentHistoryVerification::table(), $row );
			}
			if ( null === $saved['state'] ) {
				delete_option( PaymentHistoryCompatibility::STATE_OPTION );
			} else {
				update_option( PaymentHistoryCompatibility::STATE_OPTION, $saved['state'], false );
			}
			if ( null === $saved['cutover'] ) {
				delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
			} else {
				update_option( PaymentHistoryCompatibility::CUTOVER_OPTION, $saved['cutover'], true );
			}
			delete_option( $saved_option );
		}
		$result = array( 'cutover' => PaymentHistoryCompatibility::ownership_cutover() );
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_PAYMENT_CUTOVER:' . wp_json_encode( (object) $result ) . "\n";
