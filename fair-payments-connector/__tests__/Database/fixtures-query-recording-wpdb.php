<?php
/**
 * $wpdb double for the notification queue schema tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Database;

/**
 * $wpdb double that records prepared queries.
 */
class QueryRecordingWPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Executed queries as [ template, ...args ].
	 *
	 * @var array[]
	 */
	public $queries = array();

	/**
	 * Keep the template and arguments so tests can assert on them.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		return array_merge( array( $query ), $args );
	}

	/**
	 * Record a query.
	 *
	 * @param array $prepared Output of prepare().
	 * @return int
	 */
	public function query( $prepared ) {
		$this->queries[] = $prepared;
		return 1;
	}
}
