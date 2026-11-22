<?php
/**
 * FakeSaleAlertLog test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SaleAlertLog;

/**
 * In-memory alert records with the same unique key and state transitions.
 */
class FakeSaleAlertLog extends SaleAlertLog {

	/**
	 * Rows by transaction ID.
	 *
	 * @var array<int, array>
	 */
	public $rows = array();

	/**
	 * Queue unless the transaction has a row.
	 *
	 * @param int    $transaction_id Transaction ID.
	 * @param int    $event_id       Event ID.
	 * @param string $organizer_id   Organizer.
	 * @return bool
	 */
	public function queue( $transaction_id, $event_id, $organizer_id ) {
		if ( isset( $this->rows[ (int) $transaction_id ] ) ) {
			return false;
		}
		$this->rows[ (int) $transaction_id ] = array(
			'id'             => count( $this->rows ) + 1,
			'transaction_id' => (int) $transaction_id,
			'event_id'       => (int) $event_id,
			'organizer_id'   => (string) $organizer_id,
			'state'          => self::QUEUED,
			'reason'         => '',
			'created_at'     => gmdate( 'Y-m-d H:i:s' ),
			'updated_at'     => gmdate( 'Y-m-d H:i:s' ),
		);
		return true;
	}

	/**
	 * One row.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return array|null
	 */
	public function get( $transaction_id ) {
		return $this->rows[ (int) $transaction_id ] ?? null;
	}

	/**
	 * Conditional state change.
	 *
	 * @param int    $transaction_id Transaction ID.
	 * @param string $from           Expected state.
	 * @param string $to             New state.
	 * @param string $reason         Reason.
	 * @return bool
	 */
	public function transition( $transaction_id, $from, $to, $reason = '' ) {
		if ( ! isset( $this->rows[ (int) $transaction_id ] ) || $from !== $this->rows[ (int) $transaction_id ]['state'] ) {
			return false;
		}
		$this->rows[ (int) $transaction_id ]['state']      = $to;
		$this->rows[ (int) $transaction_id ]['reason']     = (string) $reason;
		$this->rows[ (int) $transaction_id ]['updated_at'] = gmdate( 'Y-m-d H:i:s' );
		return true;
	}

	/**
	 * Rows in a state.
	 *
	 * @param string   $state  State.
	 * @param int|null $before Last changed before.
	 * @param int      $limit  Limit.
	 * @return int[]
	 */
	public function in_state( $state, $before = null, $limit = 50 ) {
		$ids = array();
		foreach ( $this->rows as $id => $row ) {
			if ( $state === $row['state'] && ( null === $before || strtotime( $row['updated_at'] . ' UTC' ) < $before ) ) {
				$ids[] = $id;
			}
		}
		return array_slice( $ids, 0, $limit );
	}

	/**
	 * Age a row, as if it was last changed (and queued) seconds ago.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @param int $seconds        Age.
	 * @return void
	 */
	public function age( $transaction_id, $seconds ) {
		$this->rows[ $transaction_id ]['created_at'] = gmdate( 'Y-m-d H:i:s', time() - $seconds );
		$this->rows[ $transaction_id ]['updated_at'] = gmdate( 'Y-m-d H:i:s', time() - $seconds );
	}
}
