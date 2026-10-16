<?php
/**
 * Stand-in for wp-admin/includes/upgrade.php in unit tests.
 *
 * Tests point ABSPATH at the fixtures/wordpress directory so the installer's
 * require_once loads this file instead of WordPress core.
 *
 * @package FairEvents
 */

if ( ! function_exists( 'dbDelta' ) ) {
	/**
	 * Stub of WordPress dbDelta() that hands the statement to the database
	 * double, which records the created table.
	 *
	 * @param string $queries CREATE TABLE statement.
	 * @return array Empty list of changes.
	 */
	function dbDelta( $queries ) { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.FunctionNameInvalid -- matches the WordPress core name.
		$GLOBALS['wpdb']->db_delta( $queries );
		return array();
	}
}
