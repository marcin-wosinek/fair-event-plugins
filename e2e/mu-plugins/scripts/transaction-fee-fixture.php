<?php
/**
 * Create transactions through Transaction::create() and report the stored
 * integration fee, for the #1655 waiver/2% API regression tests.
 *
 * Creates one transaction a second before and one exactly at local midnight
 * on 1 January 2027 in the given site timezone, reads back the stored
 * application_fee of each, then deletes both and restores the timezone.
 *
 * Usage: wp eval-file .../transaction-fee-fixture.php <timezone>
 *
 * @package FairPaymentsConnector
 */

// phpcs:disable WordPress.DB.DirectDatabaseQuery -- Test fixture inspects and cleans up custom-table rows directly.

defined( 'ABSPATH' ) || exit;

use FairPaymentsConnector\Database\Schema;
use FairPaymentsConnector\Models\Transaction;

$fixture_timezone = isset( $args[0] ) ? sanitize_text_field( $args[0] ) : 'UTC';
if ( ! in_array( $fixture_timezone, timezone_identifiers_list(), true ) ) {
	WP_CLI::error( 'A valid timezone is required.' );
}

global $wpdb;
$table_name        = Schema::get_payments_table_name();
$previous_timezone = get_option( 'timezone_string', '' );
$previous_offset   = get_option( 'gmt_offset', 0 );
update_option( 'timezone_string', $fixture_timezone );

$moments = array(
	'before' => new DateTimeImmutable( '2026-12-31 23:59:59', wp_timezone() ),
	'cutoff' => new DateTimeImmutable( '2027-01-01 00:00:00', wp_timezone() ),
);
$fees    = array();

foreach ( $moments as $name => $moment ) {
	$transaction_id = Transaction::create(
		array(
			'amount'      => 1000,
			'description' => 'Integration fee fixture ' . $name,
		),
		$moment
	);
	if ( ! $transaction_id ) {
		WP_CLI::error( 'Could not create the ' . $name . ' transaction fixture.' );
	}
	$fees[ $name ] = (float) $wpdb->get_var(
		$wpdb->prepare( 'SELECT application_fee FROM %i WHERE id = %d', $table_name, $transaction_id )
	);
	$wpdb->delete( $table_name, array( 'id' => $transaction_id ), array( '%d' ) );
}

update_option( 'timezone_string', $previous_timezone );
update_option( 'gmt_offset', $previous_offset );

WP_CLI::line( 'TRANSACTION_FEE_FIXTURE:' . wp_json_encode( $fees ) );
