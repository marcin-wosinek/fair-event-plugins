<?php
/**
 * Drive the fair-payments-connector-experimental daily digest flow for the
 * digest E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/digest-flow.php <action> [args]
 *
 * Actions (each prints a single `E2E_DIGEST:{json}` line):
 *   enqueue <frequency> <include_pii 0|1>  Configure one enabled email route and
 *                                          emit three paid transactions.
 *   report                                 Print the queue rows and captured mail.
 *   flush <frequency> [fail]               Run that frequency's cron callback;
 *                                          `fail` makes wp_mail() report failure.
 *   cleanup                                Remove the route, queue rows, and mail.
 *
 * The output carries the queue rows and the mail captured by
 * fair-e2e-support.php, so the spec asserts on what a recipient would receive.
 *
 * @package FairEventsE2E
 */

use FairPaymentsConnectorExperimental\Hooks\DigestHooks;
use FairPaymentsConnectorExperimental\Settings\Settings;

const FAIR_E2E_DIGEST_ROUTE = 'e2e-digest-route';
const FAIR_E2E_DIGEST_TO    = 'owner@example.test';

global $wpdb;
$queue_table = $wpdb->prefix . 'fair_payment_notification_queue';

/**
 * Print the current queue rows and captured mail as the spec's payload.
 *
 * @param string $queue_table Queue table name.
 */
function fair_e2e_digest_report( $queue_table ) {
	global $wpdb;

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			'SELECT frequency, channel, destination, status, attempts, last_error, amount, currency, rendered_text, sent_at FROM %i WHERE route_id = %s ORDER BY id',
			$queue_table,
			FAIR_E2E_DIGEST_ROUTE
		),
		ARRAY_A
	);

	echo 'E2E_DIGEST:' . wp_json_encode(
		array(
			'rows' => is_array( $rows ) ? $rows : array(),
			'mail' => array_values( (array) get_option( 'fair_e2e_captured_mail', array() ) ),
		)
	) . "\n";
}

$step = isset( $args[0] ) ? $args[0] : '';

if ( 'cleanup' === $step ) {
	$wpdb->delete( $queue_table, array( 'route_id' => FAIR_E2E_DIGEST_ROUTE ), array( '%s' ) );
	delete_option( Settings::ROUTES_OPTION );
	delete_option( 'fair_e2e_captured_mail' );
	fair_e2e_digest_report( $queue_table );
	return;
}

if ( 'enqueue' === $step ) {
	$frequency   = isset( $args[1] ) ? $args[1] : 'daily';
	$include_pii = ! empty( $args[2] );

	$wpdb->delete( $queue_table, array( 'route_id' => FAIR_E2E_DIGEST_ROUTE ), array( '%s' ) );
	delete_option( 'fair_e2e_captured_mail' );
	update_option(
		Settings::ROUTES_OPTION,
		array(
			array(
				'id'          => FAIR_E2E_DIGEST_ROUTE,
				'enabled'     => true,
				'channel'     => 'email',
				'destination' => FAIR_E2E_DIGEST_TO,
				'frequency'   => $frequency,
				'include_pii' => $include_pii,
			),
		)
	);

	// Stand in for fair-audience, which fills participant details from the
	// transaction it looks up; these transactions are synthetic.
	add_filter(
		'fair_payment_notification_context',
		static function ( $context, $transaction ) {
			$context['participant_name']  = 'Jane Doe ' . $transaction->id;
			$context['participant_email'] = 'jane.' . $transaction->id . '@example.test';
			return $context;
		},
		10,
		2
	);

	$sales = array(
		array( 9001, '10.00', 'EUR' ),
		array( 9002, '5.50', 'EUR' ),
		array( 9003, '20.00', 'USD' ),
	);
	foreach ( $sales as $sale ) {
		do_action(
			'fair_payment_paid',
			(object) array( 'id' => 'tr_e2e_' . $sale[0] ),
			(object) array(
				'id'         => $sale[0],
				'amount'     => $sale[1],
				'currency'   => $sale[2],
				'created_at' => gmdate( 'Y-m-d H:i:s' ),
				'testmode'   => 1,
			)
		);
	}

	fair_e2e_digest_report( $queue_table );
	return;
}

if ( 'report' === $step ) {
	fair_e2e_digest_report( $queue_table );
	return;
}

if ( 'flush' === $step ) {
	$frequency = isset( $args[1] ) ? $args[1] : 'daily';

	if ( isset( $args[2] ) && 'fail' === $args[2] ) {
		// Replace the mail-capture filter so wp_mail() reports failure and
		// nothing is recorded as delivered.
		remove_all_filters( 'pre_wp_mail' );
		add_filter( 'pre_wp_mail', '__return_false' );
	}

	( new DigestHooks() )->flush_due( $frequency );

	fair_e2e_digest_report( $queue_table );
	return;
}

WP_CLI::error( 'Usage: digest-flow.php <enqueue|flush|cleanup> [args]' );
