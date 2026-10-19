<?php
/**
 * FakeExecutionHistory test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryOutcome;

/**
 * In-memory execution history with the table's semantics: one scheduled
 * execution per configuration and occurrence, conclusions recounted from
 * the deliveries.
 */
class FakeExecutionHistory extends ExecutionHistory {

	/**
	 * Executions keyed by ID.
	 *
	 * @var array[]
	 */
	public $executions = array();

	/**
	 * Deliveries keyed by ID.
	 *
	 * @var array[]
	 */
	public $deliveries = array();

	/**
	 * Constructor.
	 */
	public function __construct() {
	}

	/**
	 * Begin.
	 *
	 * @param array $execution Execution.
	 * @return array
	 */
	public function begin( array $execution ) {
		if ( HistoryOutcome::SCHEDULED === $execution['origin'] ) {
			$key = self::scheduled_key( $execution['config_id'], $execution['occurrence'] );
			foreach ( $this->executions as $id => $existing ) {
				if ( $existing['source_key'] === $key ) {
					return array(
						'id'      => $id,
						'created' => false,
					);
				}
			}
		}
		$id                      = count( $this->executions ) + 1;
		$this->executions[ $id ] = array_merge(
			$execution,
			array(
				'source_key'  => HistoryOutcome::SCHEDULED === $execution['origin'] ? self::scheduled_key( $execution['config_id'], $execution['occurrence'] ) : null,
				'lifecycle'   => HistoryOutcome::RUNNING,
				'outcome'     => '',
				'reason_code' => '',
				'counts'      => null,
				'concluded'   => 0,
			)
		);
		return array(
			'id'      => $id,
			'created' => true,
		);
	}

	/**
	 * Cover.
	 *
	 * @param int   $id   Execution.
	 * @param array $week Week.
	 * @return void
	 */
	public function cover( $id, array $week ) {
		$this->executions[ $id ]['week_start'] = $week['start'];
		$this->executions[ $id ]['week_end']   = $week['end'];
	}

	/**
	 * Attempt.
	 *
	 * @param int   $id       Execution.
	 * @param array $delivery Delivery.
	 * @return int
	 */
	public function attempt( $id, array $delivery ) {
		return $this->add(
			$id,
			$delivery + array(
				'outcome'     => HistoryOutcome::UNKNOWN,
				'reason_code' => '',
				'attempted'   => true,
			)
		);
	}

	/**
	 * Settle.
	 *
	 * @param int    $id          Execution.
	 * @param int    $delivery_id Delivery.
	 * @param string $outcome     Outcome.
	 * @param string $reason      Reason.
	 * @return void
	 */
	public function settle( $id, $delivery_id, $outcome, $reason = '' ) {
		$this->deliveries[ $delivery_id ]['outcome']     = $outcome;
		$this->deliveries[ $delivery_id ]['reason_code'] = $reason;
	}

	/**
	 * Note.
	 *
	 * @param int   $id       Execution.
	 * @param array $delivery Delivery.
	 * @return void
	 */
	public function note( $id, array $delivery ) {
		$this->add( $id, $delivery + array( 'attempted' => false ) );
	}

	/**
	 * Conclude.
	 *
	 * @param int    $id       Execution.
	 * @param string $fallback Fallback outcome.
	 * @param string $reason   Reason.
	 * @return void
	 */
	public function conclude( $id, $fallback = HistoryOutcome::SKIPPED, $reason = '' ) {
		$counts    = $this->counts( $id );
		$attempted = $counts[ HistoryOutcome::ACCEPTED ] + $counts[ HistoryOutcome::FAILED ] + $counts[ HistoryOutcome::UNKNOWN ];

		$this->executions[ $id ]['lifecycle']   = HistoryOutcome::COMPLETED;
		$this->executions[ $id ]['outcome']     = HistoryOutcome::aggregate( $counts, $fallback );
		$this->executions[ $id ]['reason_code'] = $attempted ? '' : $reason;
		$this->executions[ $id ]['counts']      = $counts;
		++$this->executions[ $id ]['concluded'];
	}

	/**
	 * Counts per outcome.
	 *
	 * @param int $id Execution.
	 * @return array
	 */
	public function counts( $id ) {
		$counts = array_fill_keys( HistoryOutcome::DELIVERY_OUTCOMES, 0 );
		foreach ( $this->of( $id ) as $delivery ) {
			++$counts[ $delivery['outcome'] ];
		}
		return $counts;
	}

	/**
	 * Deliveries of an execution.
	 *
	 * @param int $id Execution.
	 * @return array[]
	 */
	public function of( $id ) {
		return array_values(
			array_filter(
				$this->deliveries,
				static function ( $delivery ) use ( $id ) {
					return $delivery['execution_id'] === $id;
				}
			)
		);
	}

	/**
	 * The only execution.
	 *
	 * @return array
	 */
	public function only() {
		\PHPUnit\Framework\Assert::assertCount( 1, $this->executions );
		return reset( $this->executions );
	}

	/**
	 * Add a delivery.
	 *
	 * @param int   $id       Execution.
	 * @param array $delivery Delivery.
	 * @return int
	 */
	private function add( $id, array $delivery ) {
		$delivery_id                      = count( $this->deliveries ) + 1;
		$this->deliveries[ $delivery_id ] = array_merge( $delivery, array( 'execution_id' => $id ) );
		return $delivery_id;
	}
}
