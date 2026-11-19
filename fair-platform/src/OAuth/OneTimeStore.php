<?php
/**
 * Encrypted, short-lived, single-use records
 *
 * @package FairPlatform
 */

namespace FairPlatform\OAuth;

use FairEventsShared\Security\SecretBox;

defined( 'ABSPATH' ) || die;

/**
 * Stores a record under a random key that can be taken exactly once.
 *
 * Records live in the options table, never autoloaded, under the SHA-256 of
 * their key, so the key itself is never stored. Each value is encrypted with
 * a key derived from the site's salts and the store's purpose, and carries
 * its expiry in clear so expired rows can be removed without decrypting.
 *
 * Taking a record deletes its row and returns it only when this request's
 * delete removed that row: two concurrent takes of one key get it once.
 * Options are read and written with direct queries, so no object cache can
 * hand out a record that was already taken.
 */
class OneTimeStore {

	/**
	 * Option name prefix of every store.
	 */
	const OPTION_PREFIX = 'fair_platform_once_';

	/**
	 * Expired rows removed per write, so the table stays small.
	 */
	const CLEANUP_LIMIT = 20;

	/**
	 * Store purpose, part of every option name and of the encryption key.
	 *
	 * @var string
	 */
	private $purpose;

	/**
	 * Constructor.
	 *
	 * @param string $purpose Short purpose, such as `ig_state` or `ig_handoff`.
	 */
	public function __construct( $purpose ) {
		$this->purpose = preg_replace( '/[^a-z0-9_]/', '', strtolower( (string) $purpose ) );
	}

	/**
	 * Store a record.
	 *
	 * @param array $data Record.
	 * @param int   $ttl  Seconds until it expires.
	 * @return string|null Key to take it with, or null when it could not be stored.
	 */
	public function put( array $data, $ttl ) {
		global $wpdb;

		$this->remove_expired();

		$key       = self::random_key();
		$cipher    = self::encryption_key( $this->purpose );
		$json      = wp_json_encode( $data );
		$envelope  = is_string( $json ) && null !== $cipher ? SecretBox::encrypt( $json, $cipher ) : null;
		$expires   = time() + max( 1, (int) $ttl );
		$timestamp = (string) $expires;

		if ( null === $envelope ) {
			return null;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- an insert, so a duplicate name fails instead of overwriting.
		$inserted = $wpdb->insert(
			$wpdb->options,
			array(
				'option_name'  => $this->option_name( $key ),
				'option_value' => $timestamp . '|' . $envelope,
				'autoload'     => 'no',
			),
			array( '%s', '%s', '%s' )
		);

		return 1 === $inserted ? $key : null;
	}

	/**
	 * Take a record: it is removed, whether or not it is still valid.
	 *
	 * @param string $key Key from put().
	 * @return array|null Record, or null when unknown, already taken, expired or unreadable.
	 */
	public function take( $key ) {
		global $wpdb;

		if ( ! InstagramUnifiedLogin::is_store_key( $key ) ) {
			return null;
		}

		$name = $this->option_name( $key );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- must not come from a cache.
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT option_value FROM %i WHERE option_name = %s', $wpdb->options, $name ) );
		if ( ! is_string( $value ) ) {
			return null;
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$deleted = $wpdb->delete( $wpdb->options, array( 'option_name' => $name ), array( '%s' ) );
		if ( function_exists( 'wp_cache_delete' ) ) {
			wp_cache_delete( $name, 'options' );
		}

		// Another request took it first.
		if ( 1 !== $deleted ) {
			return null;
		}

		$separator = strpos( $value, '|' );
		if ( false === $separator || (int) substr( $value, 0, $separator ) < time() ) {
			return null;
		}

		$result = SecretBox::decrypt( substr( $value, $separator + 1 ), self::encryption_key( $this->purpose ) );
		if ( ! $result->is_readable() || ! $result->is_encrypted() ) {
			return null;
		}

		$data = json_decode( (string) $result->value(), true );

		return is_array( $data ) ? $data : null;
	}

	/**
	 * Remove a few expired rows of this store.
	 *
	 * @return void
	 */
	private function remove_expired() {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- housekeeping of this store's own rows.
		$rows = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT option_name FROM %i WHERE option_name LIKE %s AND CAST( SUBSTRING_INDEX( option_value, %s, 1 ) AS UNSIGNED ) < %d LIMIT %d',
				$wpdb->options,
				$wpdb->esc_like( $this->option_prefix() ) . '%',
				'|',
				time(),
				self::CLEANUP_LIMIT
			)
		);

		foreach ( (array) $rows as $name ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->delete( $wpdb->options, array( 'option_name' => $name ), array( '%s' ) );
		}
	}

	/**
	 * Option name of a key.
	 *
	 * @param string $key Key.
	 * @return string
	 */
	private function option_name( $key ) {
		return $this->option_prefix() . hash( 'sha256', $key );
	}

	/**
	 * Option name prefix of this store.
	 *
	 * @return string
	 */
	private function option_prefix() {
		return self::OPTION_PREFIX . $this->purpose . '_';
	}

	/**
	 * A random key: base64url of 32 bytes.
	 *
	 * @return string
	 */
	private static function random_key() {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- URL-safe text form of random bytes.
		return rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
	}

	/**
	 * Encryption key of a store.
	 *
	 * @param string $purpose Store purpose.
	 * @return string|null
	 */
	private static function encryption_key( $purpose ) {
		$material = function_exists( 'wp_salt' ) ? wp_salt( 'secure_auth' ) : '';

		return SecretBox::derive_key( $material, 'fair-platform/one-time-store/v1|' . $purpose );
	}
}
