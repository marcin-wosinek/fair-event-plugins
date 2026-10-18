<?php
/**
 * Fake $wpdb for SettlementApiImport tests.
 *
 * @package FairPaymentsConnector
 */

/**
 * $wpdb stand-in that accepts the operation-log writes of a step.
 */
class Fair_Test_Settlement_WPDB extends Fair_Test_WPDB {

	/**
	 * Prepare a query.
	 *
	 * @param string $query Query.
	 * @return string
	 */
	public function prepare( $query ) {
		return (string) $query;
	}

	/**
	 * Read one value.
	 *
	 * @return null
	 */
	public function get_var() {
		return null;
	}

	/**
	 * Toggle error suppression.
	 *
	 * @return bool
	 */
	public function suppress_errors() {
		return false;
	}

	/**
	 * Update rows.
	 *
	 * @return int
	 */
	public function update() {
		return 1;
	}
}
