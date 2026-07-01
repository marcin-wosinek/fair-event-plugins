<?php
/**
 * Minimal fake $wpdb for PHPUnit bootstrap.
 *
 * @package FairPaymentsConnector
 */

/**
 * Minimal fake $wpdb so PaymentLogRepository::log() -> PaymentLog::save() is a
 * no-op success instead of a fatal error on the missing global.
 */
class Fair_Test_WPDB {
	/**
	 * Table prefix, mirroring the real $wpdb->prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Last auto-generated insert ID, mirroring the real $wpdb->insert_id.
	 *
	 * @var int
	 */
	public $insert_id = 1;

	/**
	 * Stub of $wpdb->insert() — always succeeds.
	 *
	 * @param string $table  Table name.
	 * @param array  $data   Row data.
	 * @param array  $format Column formats.
	 * @return int Number of rows inserted (always 1).
	 */
	public function insert( $table, $data, $format = null ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed
		return 1;
	}
}
