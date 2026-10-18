<?php
/**
 * In-memory repository for SettlementApiImport tests.
 *
 * @package FairPaymentsConnector
 */

/**
 * In-memory settlement repository holding one run.
 */
class Fair_Test_Settlement_Repository extends \FairPaymentsConnector\Database\SettlementRepository {

	/**
	 * Runs by ID.
	 *
	 * @var array[]
	 */
	public $runs = array();

	/**
	 * Saved movements, in call order.
	 *
	 * @var array[]
	 */
	public $saved = array();

	/**
	 * Settlement updates, in call order.
	 *
	 * @var array[]
	 */
	public $settlement_updates = array();

	/**
	 * Whether saving movements fails.
	 *
	 * @var bool
	 */
	public $fail_saves = false;

	/**
	 * Take a lock.
	 *
	 * @param string $name    Lock name.
	 * @param int    $timeout Timeout.
	 * @return bool
	 */
	public function lock( $name, $timeout ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
		return true;
	}

	/**
	 * Release a lock.
	 *
	 * @param string $name Lock name.
	 */
	public function unlock( $name ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
	}

	/**
	 * Get a run.
	 *
	 * @param int $id Run ID.
	 * @return array|null
	 */
	public function get_run( $id ) {
		return $this->runs[ (int) $id ] ?? null;
	}

	/**
	 * Update a run.
	 *
	 * @param int   $id   Run ID.
	 * @param array $data Columns.
	 */
	public function update_run( $id, array $data ) {
		$this->runs[ (int) $id ] = array_merge( $this->runs[ (int) $id ], $data );
	}

	/**
	 * Find runs.
	 *
	 * @param string[] $statuses Statuses.
	 * @return array[]
	 */
	public function find_runs_by_status( array $statuses ) {
		return array_values(
			array_filter(
				$this->runs,
				static function ( $run ) use ( $statuses ) {
					return in_array( $run['status'], $statuses, true );
				}
			)
		);
	}

	/**
	 * Get an account.
	 *
	 * @param int $id Account ID.
	 * @return array
	 */
	public function get_account( $id ) {
		return array(
			'id'              => (int) $id,
			'organization_id' => 'org_unit0001',
		);
	}

	/**
	 * Save movements.
	 *
	 * @param int     $revision_id Revision ID.
	 * @param array[] $movements   Movements.
	 * @return bool
	 */
	public function save_items( $revision_id, array $movements ) {
		if ( $this->fail_saves ) {
			return false;
		}
		foreach ( $movements as $movement ) {
			$this->saved[ $movement['identity_key'] ] = $revision_id;
		}
		return true;
	}

	/**
	 * Update a settlement.
	 *
	 * @param int   $id   Settlement ID.
	 * @param array $data Columns.
	 */
	public function update_settlement( $id, array $data ) {
		$this->settlement_updates[] = array( (int) $id, $data );
	}

	/**
	 * Find a settlement by provider ID.
	 *
	 * @param int    $account_id  Account ID.
	 * @param string $provider_id Provider ID.
	 * @return null
	 */
	public function find_settlement_by_provider_id( $account_id, $provider_id ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found
		return null;
	}
}
