<?php
/**
 * Instagram Connection Repository
 *
 * @package FairPlatform
 */

namespace FairPlatform\Database;

defined( 'ABSPATH' ) || die;

/**
 * Repository for managing Instagram connection logs
 */
class InstagramConnectionRepository {
	/**
	 * Table name
	 *
	 * @var string
	 */
	private $table_name;

	/**
	 * Constructor
	 */
	public function __construct() {
		global $wpdb;
		$this->table_name = $wpdb->prefix . 'fair_platform_instagram_connections';
	}

	/**
	 * Log a connection attempt
	 *
	 * @param array $data Connection data.
	 * @return int|false Insert ID or false on failure.
	 */
	public function log_connection( $data ) {
		global $wpdb;

		$defaults = array(
			'site_id'            => '',
			'site_name'          => '',
			'site_url'           => '',
			'instagram_user_id'  => '',
			'instagram_username' => '',
			'status'             => 'connected',
			'error_code'         => null,
			'error_message'      => null,
			'scope_granted'      => '',
			'connected_at'       => current_time( 'mysql' ),
			'last_token_refresh' => null,
			'ip_address'         => $_SERVER['REMOTE_ADDR'] ?? '',
			'user_agent'         => $_SERVER['HTTP_USER_AGENT'] ?? '',
		);

		$data = wp_parse_args( $data, $defaults );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$result = $wpdb->insert(
			$this->table_name,
			$data,
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		);

		return $result ? $wpdb->insert_id : false;
	}

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

		// Build WHERE clause.
		$where = array( '1=1' );

		if ( ! empty( $args['status'] ) ) {
			$where[] = $wpdb->prepare( 'status = %s', $args['status'] );
		}

		if ( ! empty( $args['site_id'] ) ) {
			$where[] = $wpdb->prepare( 'site_id = %s', $args['site_id'] );
		}

		$where_sql = implode( ' AND ', $where );

		// Validate orderby.
		$allowed_orderby = array( 'id', 'site_name', 'status', 'connected_at' );
		$orderby         = in_array( $args['orderby'], $allowed_orderby, true ) ? $args['orderby'] : 'connected_at';

		// Validate order.
		$order = strtoupper( $args['order'] ) === 'ASC' ? 'ASC' : 'DESC';

		// Get total count.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$total = $wpdb->get_var(
			"SELECT COUNT(*) FROM {$this->table_name} WHERE {$where_sql}"
		);

		// Get items.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$items = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$this->table_name}
				WHERE {$where_sql}
				ORDER BY {$orderby} {$order}
				LIMIT %d OFFSET %d",
				$args['per_page'],
				$offset
			),
			ARRAY_A
		);

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
				"DELETE FROM {$this->table_name}
				WHERE connected_at < DATE_SUB(NOW(), INTERVAL %d DAY)",
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$stats = $wpdb->get_row(
			"SELECT
				COUNT(*) as total_connections,
				SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) as successful,
				SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
				COUNT(DISTINCT site_id) as unique_sites,
				COUNT(DISTINCT instagram_username) as unique_usernames
			FROM {$this->table_name}",
			ARRAY_A
		);

		return $stats ?: array();
	}
}
