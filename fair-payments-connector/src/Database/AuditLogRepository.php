<?php
/**
 * Audit Log Repository
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Database;

use FairPaymentsConnector\Models\AuditLogEntry;

defined( 'WPINC' ) || die;

/**
 * Repository for the settings/connection audit log.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class AuditLogRepository {

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		return Schema::get_audit_log_table_name();
	}

	/**
	 * Insert an audit log row.
	 *
	 * @param array $data Row fields — see AuditLogEntry::populate().
	 * @return bool True on success, false on failure.
	 */
	public function insert( array $data ) {
		$entry = new AuditLogEntry();
		$entry->populate( $data );
		return $entry->save();
	}

	/**
	 * Get a page of audit log entries, newest first.
	 *
	 * @param array $args {
	 *     Optional pagination.
	 *     @type int $page     1-based page number. Default 1.
	 *     @type int $per_page Page size. Default 20.
	 * }
	 * @return array{items: AuditLogEntry[], total: int}
	 */
	public function get_entries( $args = array() ) {
		global $wpdb;

		$defaults = array(
			'page'     => 1,
			'per_page' => 20,
		);
		$args     = wp_parse_args( $args, $defaults );

		$page     = max( 1, (int) $args['page'] );
		$per_page = max( 1, (int) $args['per_page'] );
		$offset   = ( $page - 1 ) * $per_page;

		$table_name = $this->get_table_name();

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY id DESC LIMIT %d OFFSET %d',
				$table_name,
				$per_page,
				$offset
			),
			ARRAY_A
		);

		$total = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name ) );

		return array(
			'items' => $this->hydrate( $results ),
			'total' => $total,
		);
	}

	/**
	 * Hydrate raw rows into AuditLogEntry objects.
	 *
	 * @param array|null $rows Raw rows from $wpdb->get_results.
	 * @return AuditLogEntry[]
	 */
	private function hydrate( $rows ) {
		if ( empty( $rows ) ) {
			return array();
		}

		$entries = array();
		foreach ( $rows as $row ) {
			$entries[] = new AuditLogEntry( $row );
		}
		return $entries;
	}
}
