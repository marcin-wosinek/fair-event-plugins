<?php
/**
 * Shared connection log storage
 *
 * @package FairPlatform
 */

namespace FairPlatform\Database;

defined( 'ABSPATH' ) || die;

/**
 * Listing, statistics, token refresh and cleanup for one connection log
 * table. Each concrete repository names its table and its own statistics,
 * and keeps its own insertion defaults.
 */
abstract class AbstractConnectionRepository {
	/**
	 * Columns a listing may be ordered by.
	 */
	private const ALLOWED_ORDERBY = array( 'id', 'site_name', 'status', 'connected_at' );

	/**
	 * Table name
	 *
	 * @var string
	 */
	protected $table_name;

	/**
	 * Constructor
	 */
	public function __construct() {
		global $wpdb;
		$this->table_name = $wpdb->prefix . $this->get_table_suffix();
	}

	/**
	 * Table name without the database prefix.
	 *
	 * @return string
	 */
	abstract protected function get_table_suffix();

	/**
	 * Provider-specific flag totals, as result key => boolean column.
	 * Reported after the status totals.
	 *
	 * @return array<string, string>
	 */
	protected function get_flag_statistics() {
		return array();
	}

	/**
	 * Provider-specific distinct counts, as result key => column.
	 * Reported after the unique site count.
	 *
	 * @return array<string, string>
	 */
	abstract protected function get_distinct_statistics();

	/**
	 * Log a connection attempt
	 *
	 * @param array $data Connection data.
	 * @return int|false Insert ID or false on failure.
	 */
	abstract public function log_connection( $data );

	/**
	 * Get connections with pagination
	 *
	 * @param array $args Query arguments.
	 * @return array
	 */
	public function get_connections( $args = array() ) {
		global $wpdb;

		$defaults = array(
			'page'     => 1,
			'per_page' => 50,
			'status'   => '',
			'site_id'  => '',
			'orderby'  => 'connected_at',
			'order'    => 'DESC',
		);

		$args   = wp_parse_args( $args, $defaults );
		$offset = ( $args['page'] - 1 ) * $args['per_page'];

		// Build WHERE clause from fixed fragments; values stay placeholders.
		$where  = array( '1=1' );
		$values = array();

		if ( ! empty( $args['status'] ) ) {
			$where[]  = 'status = %s';
			$values[] = $args['status'];
		}

		if ( ! empty( $args['site_id'] ) ) {
			$where[]  = 'site_id = %s';
			$values[] = $args['site_id'];
		}

		$where_sql = implode( ' AND ', $where );

		$orderby = in_array( $args['orderby'], self::ALLOWED_ORDERBY, true ) ? $args['orderby'] : 'connected_at';
		$order   = strtoupper( $args['order'] ) === 'ASC' ? 'ASC' : 'DESC';

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $where_sql holds fixed fragments with placeholders, $order is ASC or DESC.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$total = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i WHERE {$where_sql}",
				array_merge( array( $this->table_name ), $values )
			)
		);

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$items = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i
				WHERE {$where_sql}
				ORDER BY %i {$order}
				LIMIT %d OFFSET %d",
				array_merge(
					array( $this->table_name ),
					$values,
					array( $orderby, $args['per_page'], $offset )
				)
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array(
			'items'       => $items,
			'total'       => (int) $total,
			'page'        => $args['page'],
			'per_page'    => $args['per_page'],
			'total_pages' => ceil( $total / $args['per_page'] ),
		);
	}

	/**
	 * Update last token refresh timestamp
	 *
	 * @param string $site_id Site ID.
	 * @return bool
	 */
	public function update_token_refresh( $site_id ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (bool) $wpdb->update(
			$this->table_name,
			array( 'last_token_refresh' => current_time( 'mysql' ) ),
			array( 'site_id' => $site_id ),
			array( '%s' ),
			array( '%s' )
		);
	}

	/**
	 * Delete old connection logs
	 *
	 * @param int $days Number of days to keep.
	 * @return int Number of rows deleted.
	 */
	public function cleanup_old_logs( $days = 90 ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i
				WHERE connected_at < DATE_SUB(NOW(), INTERVAL %d DAY)',
				$this->table_name,
				$days
			)
		);
	}

	/**
	 * Get connection statistics
	 *
	 * @return array
	 */
	public function get_statistics() {
		global $wpdb;

		$select = array(
			'COUNT(*) AS %i',
			'SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS %i',
			'SUM(CASE WHEN status = %s THEN 1 ELSE 0 END) AS %i',
		);
		$values = array( 'total_connections', 'connected', 'successful', 'failed', 'failed' );

		foreach ( $this->get_flag_statistics() as $key => $column ) {
			$select[] = 'SUM(CASE WHEN %i = 1 THEN 1 ELSE 0 END) AS %i';
			array_push( $values, $column, $key );
		}

		$distinct = array_merge( array( 'unique_sites' => 'site_id' ), $this->get_distinct_statistics() );
		foreach ( $distinct as $key => $column ) {
			$select[] = 'COUNT(DISTINCT %i) AS %i';
			array_push( $values, $column, $key );
		}

		$select_sql = implode( ', ', $select );
		$values[]   = $this->table_name;

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber -- $select_sql holds fixed fragments with placeholders.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$stats = $wpdb->get_row(
			$wpdb->prepare( "SELECT {$select_sql} FROM %i", $values ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return $stats ? $stats : array();
	}
}
