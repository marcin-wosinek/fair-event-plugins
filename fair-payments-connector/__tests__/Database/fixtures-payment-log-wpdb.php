<?php
/**
 * $wpdb double for the payment log repository tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Database;

/**
 * $wpdb double that records inserts and prepared queries, and answers
 * query() with queued results.
 */
class PaymentLogWPDB extends \Fair_Test_WPDB {

	/**
	 * Executed queries as [ template, ...args ].
	 *
	 * @var array[]
	 */
	public $queries = array();

	/**
	 * Results returned by successive query() calls; 0 once exhausted.
	 *
	 * @var array
	 */
	public $query_results = array();

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
	 * Record a query and return the next queued result.
	 *
	 * @param array $prepared Output of prepare().
	 * @return int|false
	 */
	public function query( $prepared ) {
		$this->queries[] = $prepared;
		return empty( $this->query_results ) ? 0 : array_shift( $this->query_results );
	}
}
