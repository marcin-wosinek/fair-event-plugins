<?php
/**
 * Connection Repository
 *
 * @package FairPlatform
 */

namespace FairPlatform\Database;

defined( 'ABSPATH' ) || die;

/**
 * Repository for managing connection logs
 */
class ConnectionRepository extends AbstractConnectionRepository {
	/**
	 * Table name without the database prefix.
	 *
	 * @return string
	 */
	protected function get_table_suffix() {
		return 'fair_platform_connections';
	}

	/**
	 * Mollie profiles created during connection.
	 *
	 * @return array<string, string>
	 */
	protected function get_flag_statistics() {
		return array( 'profiles_created' => 'profile_created' );
	}

	/**
	 * Distinct Mollie organizations.
	 *
	 * @return array<string, string>
	 */
	protected function get_distinct_statistics() {
		return array( 'unique_organizations' => 'mollie_organization_id' );
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
			'site_id'                => '',
			'site_name'              => '',
			'site_url'               => '',
			'mollie_organization_id' => '',
			'mollie_profile_id'      => '',
			'status'                 => 'connected',
			'error_code'             => null,
			'error_message'          => null,
			'scope_granted'          => '',
			'profile_created'        => false,
			'connected_at'           => current_time( 'mysql' ),
			'last_token_refresh'     => null,
			// Stored as received, without unslashing or sanitizing (unchanged since the first release).
			// phpcs:disable WordPress.Security.ValidatedSanitizedInput.MissingUnslash, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			'ip_address'             => $_SERVER['REMOTE_ADDR'] ?? '',
			'user_agent'             => $_SERVER['HTTP_USER_AGENT'] ?? '',
			// phpcs:enable WordPress.Security.ValidatedSanitizedInput.MissingUnslash, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		);

		$data = wp_parse_args( $data, $defaults );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$result = $wpdb->insert(
			$this->table_name,
			$data,
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s' )
		);

		return $result ? $wpdb->insert_id : false;
	}
}
