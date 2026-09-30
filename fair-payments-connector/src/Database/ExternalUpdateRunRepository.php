<?php
/**
 * External Update Run Repository
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Database;

defined( 'WPINC' ) || die;

/**
 * Persistence for the External Updates operation log.
 *
 * Rows are plain associative arrays; the rules for what a run may record
 * live in \FairPaymentsConnector\Services\ExternalUpdateRuns.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ExternalUpdateRunRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		return Schema::get_external_update_runs_table_name();
	}

	/**
	 * Insert a new running run.
	 *
	 * @param array $data Columns: source_type, source_id, source_label, action, user_id, expected_total.
	 * @return int|false New run ID, or false on failure.
	 */
	public function insert( array $data ) {
		global $wpdb;

		$now = current_time( 'mysql', true );

		$inserted = $wpdb->insert(
			$this->get_table_name(),
			array(
				'source_type'    => (string) $data['source_type'],
				'source_id'      => (string) $data['source_id'],
				'source_label'   => (string) $data['source_label'],
				'action'         => (string) $data['action'],
				'user_id'        => (int) $data['user_id'],
				'status'         => 'running',
				'expected_total' => isset( $data['expected_total'] ) ? (int) $data['expected_total'] : null,
				'started_at'     => $now,
				'updated_at'     => $now,
			),
			array( '%s', '%s', '%s', '%s', '%d', '%s', '%d', '%s', '%s' )
		);

		return $inserted ? (int) $wpdb->insert_id : false;
	}

	/**
	 * Get one run.
	 *
	 * @param int $id Run ID.
	 * @return array|null
	 */
	public function get( $id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $this->get_table_name(), $id ),
			ARRAY_A
		);

		return $row ? $row : null;
	}

	/**
	 * Get the newest run that is still running, if any.
	 *
	 * @return array|null
	 */
	public function get_running() {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE status = %s ORDER BY id DESC LIMIT 1',
				$this->get_table_name(),
				'running'
			),
			ARRAY_A
		);

		return $row ? $row : null;
	}

	/**
	 * Add to a running run's counts and refresh its heartbeat.
	 *
	 * Increments happen in SQL so concurrent requests for the same run never
	 * overwrite each other's counts.
	 *
	 * @param int   $id     Run ID.
	 * @param array $counts Non-negative created/updated/skipped/failed deltas.
	 * @return bool True when a running run was updated.
	 */
	public function add_counts( $id, array $counts ) {
		global $wpdb;

		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET created_count = created_count + %d, updated_count = updated_count + %d, skipped_count = skipped_count + %d, failed_count = failed_count + %d, updated_at = %s WHERE id = %d AND status = %s',
				$this->get_table_name(),
				max( 0, (int) ( $counts['created'] ?? 0 ) ),
				max( 0, (int) ( $counts['updated'] ?? 0 ) ),
				max( 0, (int) ( $counts['skipped'] ?? 0 ) ),
				max( 0, (int) ( $counts['failed'] ?? 0 ) ),
				current_time( 'mysql', true ),
				$id,
				'running'
			)
		);

		return (bool) $updated;
	}

	/**
	 * Close a running run with its final status.
	 *
	 * @param int         $id         Run ID.
	 * @param string      $status     Final status.
	 * @param string|null $error_code Safe failure category, or null.
	 * @param int         $add_failed Extra failed count to record at close.
	 * @return bool True when a running run was closed.
	 */
	public function close( $id, $status, $error_code, $add_failed = 0 ) {
		global $wpdb;

		$now = current_time( 'mysql', true );

		if ( null === $error_code ) {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET status = %s, error_code = NULL, failed_count = failed_count + %d, updated_at = %s, finished_at = %s WHERE id = %d AND status = %s',
					$this->get_table_name(),
					$status,
					max( 0, (int) $add_failed ),
					$now,
					$now,
					$id,
					'running'
				)
			);
		} else {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE %i SET status = %s, error_code = %s, failed_count = failed_count + %d, updated_at = %s, finished_at = %s WHERE id = %d AND status = %s',
					$this->get_table_name(),
					$status,
					$error_code,
					max( 0, (int) $add_failed ),
					$now,
					$now,
					$id,
					'running'
				)
			);
		}

		return (bool) $updated;
	}

	/**
	 * Mark running runs without a recent heartbeat as interrupted.
	 *
	 * Their last recorded counts are kept.
	 *
	 * @param string $cutoff GMT datetime; runs last updated before it are stale.
	 * @return int Number of runs marked.
	 */
	public function interrupt_stale( $cutoff ) {
		global $wpdb;

		$now = current_time( 'mysql', true );

		return (int) $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET status = %s, error_code = %s, finished_at = %s WHERE status = %s AND updated_at < %s',
				$this->get_table_name(),
				'interrupted',
				'interrupted',
				$now,
				'running',
				$cutoff
			)
		);
	}

	/**
	 * Get a page of runs, newest first.
	 *
	 * @param int $page     1-based page number.
	 * @param int $per_page Page size.
	 * @return array{items: array[], total: int}
	 */
	public function get_page( $page, $per_page ) {
		global $wpdb;

		$page     = max( 1, (int) $page );
		$per_page = max( 1, (int) $per_page );

		$items = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY id DESC LIMIT %d OFFSET %d',
				$this->get_table_name(),
				$per_page,
				( $page - 1 ) * $per_page
			),
			ARRAY_A
		);

		$total = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i', $this->get_table_name() )
		);

		return array(
			'items' => $items ? $items : array(),
			'total' => $total,
		);
	}
}
