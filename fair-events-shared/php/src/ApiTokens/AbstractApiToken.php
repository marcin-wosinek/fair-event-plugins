<?php
/**
 * Shared persistence for scoped data sharing API tokens
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\ApiTokens;

defined( 'WPINC' ) || die;

/**
 * Stores and reads API tokens for a plugin's model class.
 *
 * Tokens are stored only as a SHA-256 hash. The plaintext token is generated
 * once on creation, returned to the caller so it can be shown to the admin a
 * single time, and never persisted.
 *
 * A plugin's model extends this class, names its table in table_name() and
 * lists the scopes it grants in ALLOWED_SCOPES. Every method resolves both
 * through late static binding, so the plugin's own class name, constants and
 * static methods stay its public interface.
 *
 * Plugins bundling different versions of this package can be active
 * together, and either copy may be the one loaded. Keep this class
 * additive: never add an abstract method or change a signature.
 */
abstract class AbstractApiToken {

	/**
	 * Scopes a token can be created with, and the only ones that authorize
	 * anything. A plugin's model overrides it; the default grants nothing.
	 *
	 * @var string[]
	 */
	const ALLOWED_SCOPES = array();

	/**
	 * Name of the table holding the plugin's tokens.
	 *
	 * @return string
	 */
	abstract protected static function table_name();

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

		$valid_scopes = array_values( array_intersect( $scopes, static::ALLOWED_SCOPES ) );

		$plaintext  = static::generate_token();
		$token_hash = static::hash_token( $plaintext );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$inserted = $wpdb->insert(
			static::table_name(),
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE token_hash = %s AND revoked_at IS NULL',
				static::table_name(),
				static::hash_token( $plaintext )
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				static::table_name(),
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i ORDER BY created_at DESC',
				static::table_name()
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		return (bool) $wpdb->update(
			static::table_name(),
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

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->update(
			static::table_name(),
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
	 * Scopes that are no longer granted stay in the result, so responses keep
	 * showing what an older token was created with.
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
	 * A scope that is no longer supported grants nothing, even when an older
	 * token still stores it.
	 *
	 * @param object $row   Token row.
	 * @param string $scope Scope to check.
	 * @return bool
	 */
	public static function has_scope( $row, $scope ) {
		return in_array( $scope, static::ALLOWED_SCOPES, true )
			&& in_array( $scope, static::get_scopes( $row ), true );
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
			'scopes'       => static::get_scopes( $row ),
			'created_at'   => $row->created_at,
			'last_used_at' => $row->last_used_at,
			'status'       => static::is_active( $row ) ? 'active' : 'revoked',
		);
	}
}
