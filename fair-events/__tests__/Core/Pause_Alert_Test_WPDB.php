<?php
/**
 * Lock double for PauseAlertTest.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Core;

/**
 * Session locks only: GET_LOCK succeeds unless $lock_available is false.
 */
class Pause_Alert_Test_WPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Whether GET_LOCK succeeds.
	 *
	 * @var bool
	 */
	public $lock_available = true;

	/**
	 * Lock statements run, in order.
	 *
	 * @var string[]
	 */
	public $statements = array();

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query   Query template.
	 * @param mixed  ...$args Arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		return array(
			'query' => $query,
			'args'  => $args,
		);
	}

	/**
	 * Answer lock queries.
	 *
	 * @param array $prepared Prepared query.
	 * @return string|null
	 */
	public function get_var( $prepared ) {
		if ( 0 === strpos( $prepared['query'], 'SELECT GET_LOCK' ) ) {
			$this->statements[] = 'GET_LOCK';
			return $this->lock_available ? '1' : '0';
		}
		if ( 0 === strpos( $prepared['query'], 'SELECT RELEASE_LOCK' ) ) {
			$this->statements[] = 'RELEASE_LOCK';
			return '1';
		}
		return null;
	}
}
