<?php
/**
 * Settlement Repository
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Database;

use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;

defined( 'WPINC' ) || die;

/**
 * Persistence for saved settlements: accounts, settlements, import
 * revisions, their movements, and API import runs.
 *
 * Rows are plain associative arrays; the rules for what may be written live
 * in \FairPaymentsConnector\Services\SettlementStore and the importers.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class SettlementRepository {

	/**
	 * Columns of an item row that map one-to-one onto a movement.
	 */
	const ITEM_FIELDS = array(
		'identity_key',
		'external_id',
		'payment_reference',
		'occurrence',
		'amount',
		'currency',
		'settlement_amount',
		'settlement_currency',
		'description',
		'provider_status',
		'occurred_at',
		'raw_type',
	);

	/**
	 * Start a database transaction.
	 *
	 * @return void
	 */
	public function begin() {
		global $wpdb;
		$wpdb->query( 'START TRANSACTION' );
	}

	/**
	 * Commit the open transaction.
	 *
	 * @return void
	 */
	public function commit() {
		global $wpdb;
		$wpdb->query( 'COMMIT' );
	}

	/**
	 * Roll back the open transaction.
	 *
	 * @return void
	 */
	public function rollback() {
		global $wpdb;
		$wpdb->query( 'ROLLBACK' );
	}

	/**
	 * Take a MySQL named lock.
	 *
	 * @param string $name    Lock name.
	 * @param int    $timeout Seconds to wait.
	 * @return bool True when the lock was taken.
	 */
	public function lock( $name, $timeout ) {
		global $wpdb;
		return 1 === (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK( %s, %d )', $name, $timeout ) );
	}

	/**
	 * Release a MySQL named lock.
	 *
	 * @param string $name Lock name.
	 * @return void
	 */
	public function unlock( $name ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK( %s )', $name ) );
	}

	/**
	 * Insert a row with created/updated timestamps where the table has them.
	 *
	 * @param string $table Table name.
	 * @param array  $data  Column values; null is stored as NULL.
	 * @return int|false New row ID, or false on failure.
	 */
	private function insert( $table, array $data ) {
		global $wpdb;
		return $wpdb->insert( $table, $data ) ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Get one row by ID.
	 *
	 * @param string $table Table name.
	 * @param int    $id    Row ID.
	 * @return array|null
	 */
	private function get_row( $table, $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $table, $id ), ARRAY_A );
		return $row ? $row : null;
	}

	/**
	 * Current GMT datetime.
	 *
	 * @return string
	 */
	private function now() {
		return current_time( 'mysql', true );
	}

	/*
	 * Accounts.
	 */

	/**
	 * Get one account.
	 *
	 * @param int $id Account ID.
	 * @return array|null
	 */
	public function get_account( $id ) {
		return $this->get_row( Schema::get_settlement_accounts_table_name(), $id );
	}

	/**
	 * Get every account, verified ones first.
	 *
	 * @return array[]
	 */
	public function get_accounts() {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i ORDER BY verified DESC, label ASC, id ASC', Schema::get_settlement_accounts_table_name() ),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * Find the account Mollie reported for an organization.
	 *
	 * @param string $organization_id Mollie organization ID.
	 * @return array|null
	 */
	public function find_account_by_organization( $organization_id ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE organization_id = %s', Schema::get_settlement_accounts_table_name(), $organization_id ),
			ARRAY_A
		);
		return $row ? $row : null;
	}

	/**
	 * Find an unverified account by its exact label.
	 *
	 * @param string $label Account label.
	 * @return array|null
	 */
	public function find_local_account_by_label( $label ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE verified = 0 AND label = %s ORDER BY id ASC LIMIT 1', Schema::get_settlement_accounts_table_name(), $label ),
			ARRAY_A
		);
		return $row ? $row : null;
	}

	/**
	 * Insert an account.
	 *
	 * @param array $data Columns: label, organization_id, verified.
	 * @return int|false
	 */
	public function insert_account( array $data ) {
		$now = $this->now();
		return $this->insert(
			Schema::get_settlement_accounts_table_name(),
			array(
				'label'           => (string) $data['label'],
				'organization_id' => $data['organization_id'] ?? null,
				'verified'        => empty( $data['verified'] ) ? 0 : 1,
				'created_at'      => $now,
				'updated_at'      => $now,
			)
		);
	}

	/**
	 * Update an account.
	 *
	 * @param int   $id   Account ID.
	 * @param array $data Column values.
	 * @return void
	 */
	public function update_account( $id, array $data ) {
		global $wpdb;
		$data['updated_at'] = $this->now();
		$wpdb->update( Schema::get_settlement_accounts_table_name(), $data, array( 'id' => (int) $id ) );
	}

	/**
	 * Delete an account.
	 *
	 * @param int $id Account ID.
	 * @return void
	 */
	public function delete_account( $id ) {
		global $wpdb;
		$wpdb->delete( Schema::get_settlement_accounts_table_name(), array( 'id' => (int) $id ), array( '%d' ) );
	}

	/*
	 * Settlements.
	 */

	/**
	 * Get one settlement.
	 *
	 * @param int  $id         Settlement ID.
	 * @param bool $for_update Lock the row inside the open transaction.
	 * @return array|null
	 */
	public function get_settlement( $id, $for_update = false ) {
		global $wpdb;

		if ( ! $for_update ) {
			return $this->get_row( Schema::get_settlements_table_name(), $id );
		}

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d FOR UPDATE', Schema::get_settlements_table_name(), $id ),
			ARRAY_A
		);
		return $row ? $row : null;
	}

	/**
	 * Find a settlement by the ID Mollie gave it.
	 *
	 * @param int    $account_id  Account ID.
	 * @param string $provider_id Mollie settlement ID.
	 * @return array|null
	 */
	public function find_settlement_by_provider_id( $account_id, $provider_id ) {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE account_id = %d AND provider_id = %s',
				Schema::get_settlements_table_name(),
				$account_id,
				$provider_id
			),
			ARRAY_A
		);
		return $row ? $row : null;
	}

	/**
	 * Find the settlements of an account that carry a payout reference.
	 *
	 * @param int    $account_id Account ID.
	 * @param string $reference  Payout reference.
	 * @return array[]
	 */
	public function find_settlements_by_reference( $account_id, $reference ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE account_id = %d AND reference = %s ORDER BY id ASC',
				Schema::get_settlements_table_name(),
				$account_id,
				$reference
			),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * Get every settlement of an account.
	 *
	 * @param int $account_id Account ID.
	 * @return array[]
	 */
	public function get_settlements_of_account( $account_id ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE account_id = %d ORDER BY id ASC', Schema::get_settlements_table_name(), $account_id ),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * Insert a settlement.
	 *
	 * @param array $data Column values.
	 * @return int|false
	 */
	public function insert_settlement( array $data ) {
		$now                = $this->now();
		$data['created_at'] = $now;
		$data['updated_at'] = $now;
		return $this->insert( Schema::get_settlements_table_name(), $data );
	}

	/**
	 * Update a settlement.
	 *
	 * @param int   $id   Settlement ID.
	 * @param array $data Column values; null is stored as NULL.
	 * @return void
	 */
	public function update_settlement( $id, array $data ) {
		global $wpdb;
		$data['updated_at'] = $this->now();
		$wpdb->update( Schema::get_settlements_table_name(), $data, array( 'id' => (int) $id ) );
	}

	/**
	 * Delete a settlement row (its revisions must have been moved or removed).
	 *
	 * @param int $id Settlement ID.
	 * @return void
	 */
	public function delete_settlement( $id ) {
		global $wpdb;
		$wpdb->delete( Schema::get_settlements_table_name(), array( 'id' => (int) $id ), array( '%d' ) );
	}

	/**
	 * Get a page of settlements, most recent payout first.
	 *
	 * @param int      $page       1-based page number.
	 * @param int      $per_page   Page size.
	 * @param int|null $account_id Limit to one account.
	 * @return array{items: array[], total: int}
	 */
	public function get_settlements_page( $page, $per_page, $account_id = null ) {
		global $wpdb;

		$table    = Schema::get_settlements_table_name();
		$page     = max( 1, (int) $page );
		$per_page = max( 1, (int) $per_page );
		$offset   = ( $page - 1 ) * $per_page;

		if ( null === $account_id ) {
			$items = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i ORDER BY COALESCE( settled_at, provider_created_at, created_at ) DESC, id DESC LIMIT %d OFFSET %d',
					$table,
					$per_page,
					$offset
				),
				ARRAY_A
			);
			$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table ) );
		} else {
			$items = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE account_id = %d ORDER BY COALESCE( settled_at, provider_created_at, created_at ) DESC, id DESC LIMIT %d OFFSET %d',
					$table,
					$account_id,
					$per_page,
					$offset
				),
				ARRAY_A
			);
			$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE account_id = %d', $table, $account_id ) );
		}

		return array(
			'items' => $items ? $items : array(),
			'total' => $total,
		);
	}

	/*
	 * Revisions.
	 */

	/**
	 * Insert a revision.
	 *
	 * @param array $data Column values.
	 * @return int|false
	 */
	public function insert_revision( array $data ) {
		$data['created_at'] = $this->now();
		return $this->insert( Schema::get_settlement_revisions_table_name(), $data );
	}

	/**
	 * Get one revision.
	 *
	 * @param int $id Revision ID.
	 * @return array|null
	 */
	public function get_revision( $id ) {
		return $this->get_row( Schema::get_settlement_revisions_table_name(), $id );
	}

	/**
	 * Update a revision.
	 *
	 * @param int   $id   Revision ID.
	 * @param array $data Column values.
	 * @return void
	 */
	public function update_revision( $id, array $data ) {
		global $wpdb;
		$wpdb->update( Schema::get_settlement_revisions_table_name(), $data, array( 'id' => (int) $id ) );
	}

	/**
	 * Find a settlement's revisions from one source in one status, newest first.
	 *
	 * @param int    $settlement_id Settlement ID.
	 * @param string $source        `api` or `csv`.
	 * @param string $status        Revision status.
	 * @return array[]
	 */
	public function find_revisions( $settlement_id, $source, $status ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE settlement_id = %d AND source = %s AND status = %s ORDER BY id DESC',
				Schema::get_settlement_revisions_table_name(),
				$settlement_id,
				$source,
				$status
			),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/**
	 * Move every revision of one settlement to another.
	 *
	 * @param int $from_settlement_id Settlement to move from.
	 * @param int $to_settlement_id   Settlement to move to.
	 * @return void
	 */
	public function move_revisions( $from_settlement_id, $to_settlement_id ) {
		global $wpdb;
		$wpdb->update(
			Schema::get_settlement_revisions_table_name(),
			array( 'settlement_id' => (int) $to_settlement_id ),
			array( 'settlement_id' => (int) $from_settlement_id ),
			array( '%d' ),
			array( '%d' )
		);
	}

	/**
	 * Delete a revision that was never published, with its movements.
	 *
	 * @param int $id Revision ID.
	 * @return void
	 */
	public function delete_staged_revision( $id ) {
		global $wpdb;

		$deleted = $wpdb->delete(
			Schema::get_settlement_revisions_table_name(),
			array(
				'id'     => (int) $id,
				'status' => 'staged',
			),
			array( '%d', '%s' )
		);

		if ( $deleted ) {
			$wpdb->delete( Schema::get_settlement_items_table_name(), array( 'revision_id' => (int) $id ), array( '%d' ) );
		}
	}

	/**
	 * Find the staged revisions an import run left behind.
	 *
	 * @param int $run_id Run ID.
	 * @return array[]
	 */
	public function find_staged_revisions_of_run( $run_id ) {
		global $wpdb;
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE run_id = %d AND status = %s',
				Schema::get_settlement_revisions_table_name(),
				$run_id,
				'staged'
			),
			ARRAY_A
		);
		return $rows ? $rows : array();
	}

	/*
	 * Movements.
	 */

	/**
	 * Save movements of a revision.
	 *
	 * A movement already saved under the same identity is replaced, so
	 * repeating a page of an interrupted import never duplicates anything.
	 *
	 * @param int     $revision_id Revision ID.
	 * @param array[] $movements   Movements with identities.
	 * @return void
	 */
	public function save_items( $revision_id, array $movements ) {
		global $wpdb;

		foreach ( $movements as $movement ) {
			$row = array(
				'revision_id'  => (int) $revision_id,
				'item_type'    => (string) $movement['type'],
				'is_aggregate' => $movement['is_aggregate'] ? 1 : 0,
				'needs_review' => $movement['needs_review'] ? 1 : 0,
			);
			foreach ( self::ITEM_FIELDS as $field ) {
				$row[ $field ] = $movement[ $field ];
			}
			$row['report'] = empty( $movement['report'] ) ? null : wp_json_encode( $movement['report'] );

			$wpdb->replace( Schema::get_settlement_items_table_name(), $row );
		}
	}

	/**
	 * Get the movements of a revision.
	 *
	 * @param int $revision_id Revision ID.
	 * @return array[]
	 */
	public function get_items( $revision_id ) {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE revision_id = %d ORDER BY is_aggregate ASC, occurred_at ASC, id ASC',
				Schema::get_settlement_items_table_name(),
				$revision_id
			),
			ARRAY_A
		);

		$movements = array();
		foreach ( $rows ? $rows : array() as $row ) {
			$movement = array(
				'type'         => (string) $row['item_type'],
				'is_aggregate' => (bool) (int) $row['is_aggregate'],
				'needs_review' => (bool) (int) $row['needs_review'],
			);
			foreach ( self::ITEM_FIELDS as $field ) {
				$movement[ $field ] = $row[ $field ];
			}
			$movement['occurrence'] = (int) $movement['occurrence'];
			$movement['report']     = empty( $row['report'] ) ? null : Report::from_stored( json_decode( (string) $row['report'], true ) );
			$movements[]            = Movements::make( $movement );
		}

		return $movements;
	}

	/*
	 * Import runs.
	 */

	/**
	 * Insert a running import run.
	 *
	 * @param array $data Column values.
	 * @return int|false
	 */
	public function insert_run( array $data ) {
		$now                = $this->now();
		$data['status']     = 'running';
		$data['started_at'] = $now;
		$data['updated_at'] = $now;
		return $this->insert( Schema::get_settlement_import_runs_table_name(), $data );
	}

	/**
	 * Get one import run.
	 *
	 * @param int $id Run ID.
	 * @return array|null
	 */
	public function get_run( $id ) {
		return $this->get_row( Schema::get_settlement_import_runs_table_name(), $id );
	}

	/**
	 * Update an import run and refresh its heartbeat.
	 *
	 * @param int   $id   Run ID.
	 * @param array $data Column values.
	 * @return void
	 */
	public function update_run( $id, array $data ) {
		global $wpdb;
		$data['updated_at'] = $this->now();
		$wpdb->update( Schema::get_settlement_import_runs_table_name(), $data, array( 'id' => (int) $id ) );
	}

	/**
	 * Find import runs in any of the given statuses, newest first.
	 *
	 * @param string[] $statuses Run statuses.
	 * @return array[]
	 */
	public function find_runs_by_status( array $statuses ) {
		global $wpdb;

		$placeholders = implode( ', ', array_fill( 0, count( $statuses ), '%s' ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- placeholders are generated above, one per status.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE status IN ( $placeholders ) ORDER BY id DESC",
				array_merge( array( Schema::get_settlement_import_runs_table_name() ), $statuses )
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		return $rows ? $rows : array();
	}

	/**
	 * Mark running import runs without a recent heartbeat as interrupted.
	 *
	 * Their cursors are kept so they can be continued.
	 *
	 * @param string $cutoff GMT datetime; runs last updated before it are stale.
	 * @return void
	 */
	public function interrupt_stale_runs( $cutoff ) {
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, error_code = %s WHERE status = %s AND updated_at < %s',
				Schema::get_settlement_import_runs_table_name(),
				'interrupted',
				'interrupted',
				'running',
				$cutoff
			)
		);
	}

	/**
	 * Local transaction IDs for a set of Mollie payment references.
	 *
	 * @param string[] $payment_references Mollie payment IDs.
	 * @return array<string, int> Local transaction ID per reference found.
	 */
	public function find_local_transactions( array $payment_references ) {
		global $wpdb;

		$found = array();
		foreach ( array_chunk( array_values( array_unique( $payment_references ) ), 200 ) as $chunk ) {
			$placeholders = implode( ', ', array_fill( 0, count( $chunk ), '%s' ) );

			// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- placeholders are generated above, one per reference.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT id, mollie_payment_id FROM %i WHERE mollie_payment_id IN ( $placeholders )",
					array_merge( array( Schema::get_payments_table_name() ), $chunk )
				),
				ARRAY_A
			);
			// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

			foreach ( $rows ? $rows : array() as $row ) {
				$found[ (string) $row['mollie_payment_id'] ] = (int) $row['id'];
			}
		}

		return $found;
	}
}
