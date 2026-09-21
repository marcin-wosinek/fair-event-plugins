<?php
/**
 * $wpdb double for the notification enqueue tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Hooks;

/**
 * Minimal $wpdb double that records insert() calls.
 */
class InsertRecordingWPDB {

	/**
	 * Table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Last database error.
	 *
	 * @var string
	 */
	public $last_error = '';

	/**
	 * Recorded inserts as [ table, data ].
	 *
	 * @var array[]
	 */
	public $inserts = array();

	/**
	 * Whether insert() should fail.
	 *
	 * @var bool
	 */
	public $fail = false;

	/**
	 * Record an insert.
	 *
	 * @param string $table Table.
	 * @param array  $data  Column values.
	 * @return int|false
	 */
	public function insert( $table, $data ) {
		$this->inserts[] = array( $table, $data );
		return $this->fail ? false : 1;
	}
}
