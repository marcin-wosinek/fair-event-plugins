<?php
/**
 * API Token Model
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Models;

defined( 'WPINC' ) || die;

/**
 * Model class for data sharing API tokens.
 *
 * Tokens are stored only as a SHA-256 hash. The plaintext token is generated
 * once on creation, returned to the caller so it can be shown to the admin a
 * single time, and never persisted.
 */
class ApiToken {
	/**
	 * Allowed scopes for API tokens.
	 *
	 * @var string[]
	 */
	const ALLOWED_SCOPES = array( 'transactions:read', 'locations:read' );

	/**
	 * Generate a new cryptographically random plaintext token.
	 *
	 * @return string 40-character token.
	 */
	public static function generate_token() {
		return wp_generate_password( 40, false );
	}

	/**
	 * Hash a plaintext token for storage / lookup.
	 *
	 * @param string $plaintext Plaintext token.
	 * @return string SHA-256 hex hash.
	 */
	public static function hash_token( $plaintext ) {
		return hash( 'sha256', $plaintext );
	}

	/**
	 * Create a new API token.
	 *
	 * @param string   $label  Human-readable label (e.g. "lamutable.es").
	 * @param string[] $scopes List of scopes to grant.
	 * @return array|false Array with 'id' and one-time plaintext 'token', or false on failure.
	 */
	public static function create( $label, array $scopes ) {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		$valid_scopes = array_values( array_intersect( $scopes, self::ALLOWED_SCOPES ) );

		$plaintext  = self::generate_token();
		$token_hash = self::hash_token( $plaintext );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$inserted = $wpdb->insert(
			$table_name,
			array(
				'label'      => $label,
				'token_hash' => $token_hash,
				'scopes'     => wp_json_encode( $valid_scopes ),
				'created_at' => current_time( 'mysql', true ),
			),
			array( '%s', '%s', '%s', '%s' )
		);

		if ( ! $inserted ) {
			return false;
		}

		return array(
			'id'    => (int) $wpdb->insert_id,
			'token' => $plaintext,
		);
	}

	/**
	 * Find an active (non-revoked) token row by its plaintext value.
	 *
	 * @param string $plaintext Plaintext token.
	 * @return object|null Token row or null if not found / revoked.
	 */
	public static function find_by_token( $plaintext ) {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		$token_hash = self::hash_token( $plaintext );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE token_hash = %s AND revoked_at IS NULL',
				$table_name,
				$token_hash
			)
		);
	}

	/**
	 * Get a single token row by ID.
	 *
	 * @param int $id Token ID.
	 * @return object|null Token row or null.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$id
			)
		);
	}

	/**
	 * Get all token rows, newest first.
	 *
	 * @return object[] Array of token rows.
	 */
	public static function get_all() {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY created_at DESC',
				$table_name
			)
		);
	}

	/**
	 * Revoke a token by ID.
	 *
	 * @param int $id Token ID.
	 * @return bool True on success.
	 */
	public static function revoke( $id ) {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (bool) $wpdb->update(
			$table_name,
			array( 'revoked_at' => current_time( 'mysql', true ) ),
			array( 'id' => $id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Update the last_used_at timestamp for a token.
	 *
	 * @param int $id Token ID.
	 * @return void
	 */
	public static function touch_last_used( $id ) {
		global $wpdb;
		$table_name = \FairPaymentsConnector\Database\Schema::get_api_tokens_table_name();

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->update(
			$table_name,
			array( 'last_used_at' => current_time( 'mysql', true ) ),
			array( 'id' => $id ),
			array( '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Whether a token row is active (not revoked).
	 *
	 * @param object $row Token row.
	 * @return bool
	 */
	public static function is_active( $row ) {
		return $row && null === $row->revoked_at;
	}

	/**
	 * Decode the scopes stored on a token row.
	 *
	 * @param object $row Token row.
	 * @return string[] List of scopes.
	 */
	public static function get_scopes( $row ) {
		if ( ! $row || empty( $row->scopes ) ) {
			return array();
		}

		$scopes = json_decode( $row->scopes, true );

		return is_array( $scopes ) ? $scopes : array();
	}

	/**
	 * Whether a token row grants the given scope.
	 *
	 * @param object $row   Token row.
	 * @param string $scope Scope to check.
	 * @return bool
	 */
	public static function has_scope( $row, $scope ) {
		return in_array( $scope, self::get_scopes( $row ), true );
	}

	/**
	 * Convert a token row to a safe array for API responses.
	 *
	 * Never includes the token hash or any plaintext.
	 *
	 * @param object $row Token row.
	 * @return array
	 */
	public static function to_array( $row ) {
		return array(
			'id'           => (int) $row->id,
			'label'        => $row->label,
			'scopes'       => self::get_scopes( $row ),
			'created_at'   => $row->created_at,
			'last_used_at' => $row->last_used_at,
			'status'       => self::is_active( $row ) ? 'active' : 'revoked',
		);
	}
}
