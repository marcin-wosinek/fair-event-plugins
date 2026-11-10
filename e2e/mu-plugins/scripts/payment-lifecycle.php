<?php
/**
 * Drive and inspect the fair-events purchase lifecycle, for
 * PaymentLifecycleCutover and AudienceLifecycleCutover API coverage (#2140,
 * stage 4 of #2111). The lifecycle is unconditional (#2251): the specs run
 * it with no cutover activation recorded.
 *
 * Usage: wp eval-file .../payment-lifecycle.php <action> <json>
 *
 * Actions:
 *   clear       {}  Remove any recorded cutover activation, keeping it to
 *                   restore.
 *   restore     {}  Put back the activation `clear` removed.
 *   settle      {transactionId, status, throwOnConfirmed?, throwOnApplied?}
 *                   Connector reports the status (paid or failed): every
 *                   payment hook runs, as for a webhook. Counts the
 *                   confirmation, failure and Fair Audience projection
 *                   announcements. With throwOnConfirmed (throwOnApplied),
 *                   the first confirmation (projection) listener throws, as
 *                   a request dying after the change committed would.
 *   status      {transactionId, status}  Only change the status stored in
 *                   Connector, firing no hook (an attempt that failed
 *                   before its notification arrived).
 *   mollie-status {status?}  The status the Mollie double reports when a
 *                   payment is synced; none restores its default (paid).
 *   due         {}  Make the lifecycle's queued work due and run the retry
 *                   cron's processing once, counting announcements.
 *   state       {signupIds, transactionIds}  Purchases, links per
 *                   transaction, lifecycle work rows and findings. Each
 *                   linked purchase is listed with its relationship (Fair
 *                   Audience) and its tickets' activities.
 *   parallel    {runs: [{action, data, delayMs?}]}  Run actions in
 *                   concurrent processes; results in order.
 *   cleanup     {signupIds, transactionIds}  Links, work rows and findings.
 *
 * Prints one `E2E_PAYMENT_LIFECYCLE:{json}` line.
 *
 * @package FairEventsE2E
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 * phpcs:disable WordPress.PHP.DiscouragedPHPFunctions.system_calls_proc_open, WordPress.WP.AlternativeFunctions -- The parallel action runs WP-CLI children in the test container.
 */

defined( 'ABSPATH' ) || exit;

use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Services\PaymentHistoryCompatibility;
use FairEvents\Services\PaymentHistoryShadowWrites;

global $wpdb;

$fixture_action = isset( $args[0] ) ? (string) $args[0] : '';
$data           = isset( $args[1] ) ? json_decode( (string) $args[1], true ) : array();
if ( ! is_array( $data ) ) {
	WP_CLI::error( 'Second argument must be a JSON object.' );
}

$saved_option       = 'fair_e2e_payment_lifecycle_saved_cutover';
$links_table        = $wpdb->prefix . 'fair_events_signup_payment_links';
$signups_table      = $wpdb->prefix . 'fair_events_signups';
$transactions_table = \FairPaymentsConnector\Database\Schema::get_payments_table_name();
$result             = array();

$announcements = array(
	'confirmed' => 0,
	'failed'    => 0,
	'applied'   => 0,
);
$count_hooks   = static function () use ( &$announcements ) {
	add_action(
		'fair_events_signup_confirmed',
		static function () use ( &$announcements ) {
			++$announcements['confirmed'];
		},
		0
	);
	add_action(
		'fair_events_signup_payment_failed',
		static function () use ( &$announcements ) {
			++$announcements['failed'];
		},
		0
	);
	add_action(
		'fair_events_purchase_payment_applied',
		static function () use ( &$announcements ) {
			++$announcements['applied'];
		},
		0
	);
};

switch ( $fixture_action ) {
	case 'clear':
		if ( false === get_option( $saved_option, false ) ) {
			update_option( $saved_option, array( 'cutover' => get_option( PaymentHistoryCompatibility::CUTOVER_OPTION, null ) ), false );
		}
		delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
		$result = array( 'cutover' => PaymentHistoryCompatibility::ownership_cutover() );
		break;

	case 'restore':
		$saved = get_option( $saved_option, false );
		if ( is_array( $saved ) && is_array( $saved['cutover'] ?? null ) ) {
			update_option( PaymentHistoryCompatibility::CUTOVER_OPTION, $saved['cutover'], true );
		} else {
			delete_option( PaymentHistoryCompatibility::CUTOVER_OPTION );
		}
		delete_option( $saved_option );
		$result = array( 'cutover' => PaymentHistoryCompatibility::ownership_cutover() );
		break;

	case 'settle':
		$count_hooks();
		if ( ! empty( $data['throwOnApplied'] ) ) {
			add_action(
				'fair_events_purchase_payment_applied',
				static function () {
					throw new RuntimeException( 'E2E: request interrupted after the payment was applied.' );
				},
				1
			);
		}
		if ( ! empty( $data['throwOnConfirmed'] ) ) {
			add_action(
				'fair_events_signup_confirmed',
				static function () {
					throw new RuntimeException( 'E2E: request interrupted after the confirmation.' );
				},
				1
			);
		}
		$settled_status = (string) $data['status'];
		$wpdb->update( $transactions_table, array( 'status' => $settled_status ), array( 'id' => (int) $data['transactionId'] ) );
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $data['transactionId'] );
		$payment     = (object) array(
			'id'     => 'tr_e2e_lifecycle',
			'status' => $settled_status,
		);
		$threw       = false;
		try {
			do_action( 'paid' === $settled_status ? 'fair_payment_paid' : 'fair_payment_failed', $payment, $transaction );
			do_action( 'fair_payment_status_changed', $payment, $transaction );
		} catch ( RuntimeException $error ) {
			$threw = true;
		}
		PaymentHistoryShadowWrites::process_queued();
		$result = array(
			'threw'         => $threw,
			'announcements' => $announcements,
		);
		break;

	case 'status':
		$wpdb->update( $transactions_table, array( 'status' => sanitize_key( (string) $data['status'] ) ), array( 'id' => (int) $data['transactionId'] ) );
		$result = array( 'status' => sanitize_key( (string) $data['status'] ) );
		break;

	case 'mollie-status':
		if ( empty( $data['status'] ) ) {
			delete_option( 'fair_e2e_mollie_get_status' );
		} else {
			update_option( 'fair_e2e_mollie_get_status', sanitize_key( (string) $data['status'] ) );
		}
		$result = array( 'status' => get_option( 'fair_e2e_mollie_get_status', 'paid' ) );
		break;

	case 'due':
		$count_hooks();
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET next_attempt_at = %s WHERE kind IN (%s, %s, %s)',
				PaymentShadowWork::table(),
				gmdate( 'Y-m-d H:i:s', time() - 1 ),
				PaymentShadowWork::KIND_PAYMENT,
				PaymentShadowWork::KIND_CONFIRMATION,
				PaymentShadowWork::KIND_PROJECTION
			)
		);
		$result = array(
			'processed'     => PaymentHistoryShadowWrites::process_due( 50 ),
			'announcements' => $announcements,
		);
		break;

	case 'state':
		$result = array(
			'signups'      => array(),
			'transactions' => array(),
		);
		foreach ( array_map( 'intval', (array) ( $data['signupIds'] ?? array() ) ) as $signup_id ) {
			$finding                         = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT status, detail FROM %i WHERE mode = %s AND reason = %s AND source_type = %s AND source_id = %d',
					PaymentHistoryFinding::table(),
					PaymentHistoryFinding::MODE_BACKFILL,
					'multiple_paid_attempts',
					PaymentHistoryFinding::SOURCE_SIGNUP,
					$signup_id
				),
				ARRAY_A
			);
			$result['signups'][ $signup_id ] = array(
				'signup'                 => $wpdb->get_row( $wpdb->prepare( 'SELECT id, status, transaction_id, payment_expires_at FROM %i WHERE id = %d', $signups_table, $signup_id ), ARRAY_A ),
				'confirmation_work'      => PaymentShadowWork::get( PaymentShadowWork::KIND_CONFIRMATION, $signup_id ),
				'multiple_paid_attempts' => $finding ? array(
					'status' => $finding['status'],
					'detail' => json_decode( (string) $finding['detail'], true ),
				) : null,
			);
		}
		$result['purchases'] = array();
		foreach ( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) as $transaction_id ) {
			$links                                     = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT signup_id, role, allocated_amount, attribution FROM %i WHERE transaction_id = %d ORDER BY id', $links_table, $transaction_id ), ARRAY_A );
			$result['transactions'][ $transaction_id ] = array(
				'links'            => $links,
				'transaction_work' => PaymentShadowWork::get( PaymentShadowWork::KIND_TRANSACTION, $transaction_id ),
				'payment_work'     => PaymentShadowWork::get( PaymentShadowWork::KIND_PAYMENT, $transaction_id ),
				'projection_work'  => PaymentShadowWork::get( PaymentShadowWork::KIND_PROJECTION, $transaction_id ),
				'ledger'           => array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( 'SELECT event_participant_id FROM %i WHERE transaction_id = %d ORDER BY event_participant_id', $wpdb->prefix . 'fair_audience_event_participant_transactions', $transaction_id ) ) ),
			);
			foreach ( $links as $link_row ) {
				$signup_id = (int) $link_row['signup_id'];
				if ( isset( $result['purchases'][ $signup_id ] ) ) {
					continue;
				}
				$purchase                          = $wpdb->get_row( $wpdb->prepare( 'SELECT id, status, ticket_type_id, amount, legacy_event_participant_id, participant_id, event_date_id FROM %i WHERE id = %d', $signups_table, $signup_id ), ARRAY_A );
				$relationship_id                   = (int) ( $purchase['legacy_event_participant_id'] ?? 0 );
				$result['purchases'][ $signup_id ] = array(
					'purchase'     => $purchase,
					'relationship' => $relationship_id ? $wpdb->get_row( $wpdb->prepare( 'SELECT id, label, ticket_type_id, payment_expires_at FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_event_participants', $relationship_id ), ARRAY_A ) : null,
					'activities'   => (array) $wpdb->get_results(
						$wpdb->prepare(
							'SELECT a.ticket_id, a.ticket_option_id, a.status FROM %i AS a INNER JOIN %i AS t ON t.id = a.ticket_id WHERE t.signup_id = %d ORDER BY a.ticket_option_id',
							$wpdb->prefix . 'fair_events_ticket_activities',
							$wpdb->prefix . 'fair_events_tickets',
							$signup_id
						),
						ARRAY_A
					),
				);
			}
		}
		break;

	case 'parallel':
		$children = array();
		foreach ( (array) $data['runs'] as $run ) {
			usleep( 1000 * (int) ( $run['delayMs'] ?? 0 ) );
			$stderr     = wp_tempnam( 'e2e-payment-lifecycle' );
			$command    = implode(
				' ',
				array_map(
					'escapeshellarg',
					array(
						'wp',
						'eval-file',
						__FILE__,
						(string) $run['action'],
						wp_json_encode( (object) ( $run['data'] ?? array() ) ),
						'--path=' . ABSPATH,
					)
				)
			);
			$pipes      = array();
			$process    = proc_open(
				$command,
				array(
					1 => array( 'pipe', 'w' ),
					2 => array( 'file', $stderr, 'w' ),
				),
				$pipes
			);
			$children[] = array( $process, $pipes, $stderr );
		}
		$result['results'] = array();
		foreach ( $children as list( $process, $pipes, $stderr ) ) {
			$stdout = stream_get_contents( $pipes[1] );
			fclose( $pipes[1] );
			$exit_code    = proc_close( $process );
			$child_errors = (string) file_get_contents( $stderr );
			wp_delete_file( $stderr );
			if ( 0 !== $exit_code || ! preg_match( '/E2E_PAYMENT_LIFECYCLE:(\{.*\})/', $stdout, $match ) ) {
				WP_CLI::error( "Parallel run failed ({$exit_code}):\n{$stdout}{$child_errors}" );
			}
			$result['results'][] = json_decode( $match[1], true );
		}
		break;

	case 'cleanup':
		foreach ( array_filter( array_map( 'intval', (array) ( $data['transactionIds'] ?? array() ) ) ) as $transaction_id ) {
			$wpdb->delete( $links_table, array( 'transaction_id' => $transaction_id ) );
			foreach ( array( PaymentShadowWork::KIND_TRANSACTION, PaymentShadowWork::KIND_PAYMENT, PaymentShadowWork::KIND_PROJECTION ) as $kind ) {
				PaymentShadowWork::complete( $kind, $transaction_id );
			}
		}
		foreach ( array_filter( array_map( 'intval', (array) ( $data['signupIds'] ?? array() ) ) ) as $signup_id ) {
			$wpdb->delete( $links_table, array( 'signup_id' => $signup_id ) );
			PaymentShadowWork::complete( PaymentShadowWork::KIND_CONFIRMATION, $signup_id );
			$wpdb->delete(
				PaymentHistoryFinding::table(),
				array(
					'source_type' => PaymentHistoryFinding::SOURCE_SIGNUP,
					'source_id'   => $signup_id,
				)
			);
		}
		break;

	default:
		WP_CLI::error( "Unknown action: {$fixture_action}" );
}

echo 'E2E_PAYMENT_LIFECYCLE:' . wp_json_encode( (object) $result ) . "\n";
