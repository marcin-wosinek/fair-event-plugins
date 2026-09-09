<?php
/**
 * Seed and clean up transaction timestamp fixtures for API regression tests.
 *
 * Usage: wp eval-file .../payment-timestamp-fixture.php <setup|inspect|timezone|cleanup> <fixture-key> [timezone]
 *
 * @package FairPaymentsConnector
 */

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test fixture inspects and cleans up custom-table rows directly.

defined( 'ABSPATH' ) || exit;

use FairPaymentsConnector\Database\Schema;
use FairPaymentsConnector\Models\Transaction;

$fixture_action = isset( $args[0] ) ? sanitize_key( $args[0] ) : '';
$fixture_key    = isset( $args[1] ) ? sanitize_key( $args[1] ) : '';
$option_key     = 'fair_payment_timestamp_fixture_' . $fixture_key;

if ( ! $fixture_key ) {
	WP_CLI::error( 'A fixture key is required.' );
}

global $wpdb;
$table_name = Schema::get_payments_table_name();

if ( 'setup' === $fixture_action ) {
	$state = array(
		'timezone_string' => get_option( 'timezone_string', '' ),
		'gmt_offset'      => get_option( 'gmt_offset', 0 ),
		'ids'             => array(),
	);
	update_option( $option_key, $state, false );
	update_option( 'timezone_string', 'UTC' );
	update_option( 'gmt_offset', 0 );

	$new_id = Transaction::create(
		array(
			'amount'      => 10,
			'description' => 'Timestamp regression fixture ' . $fixture_key,
		)
	);
	if ( ! $new_id ) {
		WP_CLI::error( 'Could not create the initiated transaction fixture.' );
	}

	sleep( 2 );
	if ( ! Transaction::mark_payment_initiated( $new_id, 'tr_' . $fixture_key . '_new', 'https://example.com/checkout' ) ) {
		WP_CLI::error( 'Could not initiate the transaction fixture.' );
	}
	$wpdb->update( $table_name, array( 'status' => 'paid' ), array( 'id' => $new_id ), array( '%s' ), array( '%d' ) );

	$fixed_values = array(
		'summer' => '2026-07-15 10:00:00',
		'winter' => '2026-01-15 10:00:00',
		'utc'    => '2025-04-10 08:15:30',
		'legacy' => '2025-04-10 10:15:30',
	);
	$ids          = array( 'new' => (int) $new_id );

	foreach ( $fixed_values as $name => $timestamp ) {
		$transaction_id = Transaction::create(
			array(
				'mollie_payment_id' => 'tr_' . $fixture_key . '_' . $name,
				'amount'            => 10,
				'status'            => 'paid',
				'description'       => 'Timestamp regression fixture ' . $fixture_key,
			)
		);
		if ( ! $transaction_id ) {
			WP_CLI::error( 'Could not create the ' . $name . ' transaction fixture.' );
		}
		$wpdb->update(
			$table_name,
			array(
				'created_at'           => $timestamp,
				'payment_initiated_at' => $timestamp,
				'updated_at'           => $timestamp,
			),
			array( 'id' => $transaction_id ),
			array( '%s', '%s', '%s' ),
			array( '%d' )
		);
		$ids[ $name ] = (int) $transaction_id;
	}

	$state['ids'] = $ids;
	update_option( $option_key, $state, false );
} elseif ( 'timezone' === $fixture_action ) {
	$timezone = isset( $args[2] ) ? sanitize_text_field( $args[2] ) : '';
	if ( ! in_array( $timezone, timezone_identifiers_list(), true ) ) {
		WP_CLI::error( 'A valid timezone is required.' );
	}
	update_option( 'timezone_string', $timezone );
} elseif ( 'cleanup' === $fixture_action ) {
	$state = get_option( $option_key, array() );
	if ( ! empty( $state['ids'] ) ) {
		foreach ( $state['ids'] as $transaction_id ) {
			$wpdb->delete( $table_name, array( 'id' => absint( $transaction_id ) ), array( '%d' ) );
		}
	}
	if ( array_key_exists( 'timezone_string', $state ) ) {
		update_option( 'timezone_string', $state['timezone_string'] );
	}
	if ( array_key_exists( 'gmt_offset', $state ) ) {
		update_option( 'gmt_offset', $state['gmt_offset'] );
	}
	delete_option( $option_key );
} elseif ( 'inspect' !== $fixture_action ) {
	WP_CLI::error( 'Unknown fixture action.' );
}

$state = get_option( $option_key, array() );
$rows  = array();
if ( ! empty( $state['ids'] ) ) {
	foreach ( $state['ids'] as $transaction_id ) {
		$rows[] = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT id, created_at, payment_initiated_at, updated_at FROM %i WHERE id = %d',
				$table_name,
				absint( $transaction_id )
			),
			ARRAY_A
		);
	}
}

WP_CLI::line(
	'PAYMENT_TIMESTAMP_FIXTURE:' . wp_json_encode(
		array(
			'ids'      => $state['ids'] ?? array(),
			'rows'     => $rows,
			'timezone' => wp_timezone_string(),
		)
	)
);
