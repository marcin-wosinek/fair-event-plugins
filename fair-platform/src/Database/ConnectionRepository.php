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
	 * Mollie account columns. The refresh token fingerprint is not listed.
	 *
	 * @return string[]
	 */
	protected function get_listed_columns() {
		return array( 'mollie_organization_id', 'mollie_profile_id', 'profile_created' );
	}

	/**
	 * Whether a Mollie profile was created during connection.
	 *
	 * @return string[]
	 */
	protected function get_boolean_columns() {
		return array( 'profile_created' );
	}

	/**
	 * Log a connection attempt
	 *
	 * A connected row bound to a refresh token takes that binding over from
	 * the same site's earlier rows: Mollie can hand back the same refresh
	 * token on re-authorization, and a token bound to several connected
	 * rows is never attributed. Earlier rows keep their dates.
	 *
	 * @param array $data Connection data.
	 * @return int|false Insert ID or false on failure.
	 */
	public function log_connection( $data ) {
		global $wpdb;

		$defaults = array(
			'site_id'                   => '',
			'site_name'                 => '',
			'site_url'                  => '',
			'mollie_organization_id'    => '',
			'mollie_profile_id'         => '',
			'status'                    => 'connected',
			'error_code'                => null,
			'error_message'             => null,
			'scope_granted'             => '',
			'profile_created'           => false,
			'connected_at'              => current_time( 'mysql' ),
			'last_token_refresh'        => null,
			'refresh_token_fingerprint' => null,
			// Stored as received, without unslashing or sanitizing (unchanged since the first release).
			// phpcs:disable WordPress.Security.ValidatedSanitizedInput.MissingUnslash, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
			'ip_address'                => $_SERVER['REMOTE_ADDR'] ?? '',
			'user_agent'                => $_SERVER['HTTP_USER_AGENT'] ?? '',
			// phpcs:enable WordPress.Security.ValidatedSanitizedInput.MissingUnslash, WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		);

		$data = wp_parse_args( $data, $defaults );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$result = $wpdb->insert(
			$this->table_name,
			$data,
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		if ( ! $result ) {
			return false;
		}

		$insert_id = (int) $wpdb->insert_id;

		if ( 'connected' === $data['status'] && is_string( $data['refresh_token_fingerprint'] ) && '' !== $data['refresh_token_fingerprint'] ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query(
				$wpdb->prepare(
					'UPDATE %i
					SET refresh_token_fingerprint = NULL
					WHERE site_id = %s
						AND refresh_token_fingerprint = %s
						AND id < %d',
					$this->table_name,
					$data['site_id'],
					$data['refresh_token_fingerprint'],
					$insert_id
				)
			);
		}

		return $insert_id;
	}

	/**
	 * Record a successful token refresh on the one connected row bound to
	 * the refresh token that was exchanged.
	 *
	 * Nothing is written when no connected row, or more than one, carries
	 * the fingerprint (an unbound legacy connection, or an ambiguous
	 * binding). The write is conditional on the previous fingerprint and on
	 * not moving the timestamp backwards, so a stale concurrent refresh
	 * cannot overwrite a newer binding or time. `connected_at` is never
	 * changed.
	 *
	 * @param string      $fingerprint     Fingerprint of the refresh token the site sent.
	 * @param string|null $new_fingerprint Fingerprint of a rotated refresh token, or null when Mollie kept the token.
	 * @param string      $refreshed_at    MySQL datetime of the successful exchange.
	 * @return bool Whether a row was updated.
	 */
	public function record_token_refresh( $fingerprint, $new_fingerprint, $refreshed_at ) {
		global $wpdb;

		if ( ! is_string( $fingerprint ) || '' === $fingerprint ) {
			return false;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT id FROM %i WHERE refresh_token_fingerprint = %s AND status = %s LIMIT 2',
				$this->table_name,
				$fingerprint,
				'connected'
			)
		);

		if ( 1 !== count( $ids ) ) {
			return false;
		}

		$next_fingerprint = is_string( $new_fingerprint ) && '' !== $new_fingerprint ? $new_fingerprint : $fingerprint;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i
				SET last_token_refresh = %s, refresh_token_fingerprint = %s
				WHERE id = %d
					AND refresh_token_fingerprint = %s
					AND status = %s
					AND ( last_token_refresh IS NULL OR last_token_refresh <= %s )',
				$this->table_name,
				$refreshed_at,
				$next_fingerprint,
				(int) $ids[0],
				$fingerprint,
				'connected',
				$refreshed_at
			)
		);

		return 1 === $updated;
	}
}
