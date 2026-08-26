<?php
/**
 * Database double for expiry tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

/**
 * Minimal database double for pending-payment capacity and cleanup queries.
 */
class Expiry_WPDB {
	/**
	 * WordPress table prefix.
	 *
	 * @var string
	 */
	public $prefix = 'wp_';

	/**
	 * Seeded participant rows.
	 *
	 * @var array<int, object>
	 */
	public $rows = array();

	/**
	 * Most recent prepared query.
	 *
	 * @var array|null
	 */
	public $last_prepared = null;

	/**
	 * Capture a prepared query.
	 *
	 * @param string $query Query template.
	 * @param mixed  ...$args Query arguments.
	 * @return array
	 */
	public function prepare( $query, ...$args ) {
		if ( 1 === count( $args ) && is_array( $args[0] ) ) {
			$args = $args[0];
		}
		$this->last_prepared = array(
			'query' => $query,
			'args'  => $args,
		);
		return $this->last_prepared;
	}

	/**
	 * Count confirmed and unexpired rows.
	 *
	 * @param array $prepared Prepared query.
	 * @return int
	 */
	public function get_var( $prepared ) {
		if ( false !== strpos( $prepared['query'], "status = 'confirmed'" ) ) {
			return 0;
		}

		$event_date_id = (int) $prepared['args'][1];
		$now           = $prepared['args'][2];
		$count         = 0;

		foreach ( $this->rows as $row ) {
			if ( $row->event_date_id !== $event_date_id ) {
				continue;
			}
			if ( 'signed_up' === $row->label || ( 'pending_payment' === $row->label && $row->payment_expires_at > $now ) ) {
				++$count;
			}
		}

		return $count;
	}

	/**
	 * Return cleanup candidates at or before the comparison instant.
	 *
	 * @param array $prepared Prepared query.
	 * @return array
	 */
	public function get_results( $prepared ) {
		$now = $prepared['args'][1];
		return array_values(
			array_filter(
				$this->rows,
				function ( $row ) use ( $now ) {
					return 'pending_payment' === $row->label && $row->payment_expires_at <= $now;
				}
			)
		);
	}

	/**
	 * Delete rows selected by their IDs.
	 *
	 * @param array $prepared Prepared query.
	 * @return int
	 */
	public function query( $prepared ) {
		$ids     = array_map( 'intval', array_slice( $prepared['args'], 1 ) );
		$deleted = 0;
		foreach ( $ids as $id ) {
			if ( isset( $this->rows[ $id ] ) ) {
				unset( $this->rows[ $id ] );
				++$deleted;
			}
		}
		return $deleted;
	}
}
