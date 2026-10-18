<?php
/**
 * Database session lock for event notification bookkeeping.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Named MySQL session locks, unique per site on a shared database server.
 *
 * Used where two requests must not interleave: the takeover and upgrade of
 * notification data, and adding a configuration to the list.
 */
class Lock {
	// MySQL rejects lock names over 64 characters; name() appends 33.
	public const MIGRATION      = 'fair_events_notif_migration';
	public const CONFIGURATIONS = 'fair_events_notif_configs';

	/**
	 * Take a lock.
	 *
	 * @param string $lock    Lock constant.
	 * @param int    $timeout Seconds to wait for it.
	 * @return bool Whether this request holds the lock.
	 */
	public static function acquire( $lock, $timeout = 0 ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session lock, nothing to cache.
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', self::name( $lock ), $timeout ) );
	}

	/**
	 * Release a lock.
	 *
	 * @param string $lock Lock constant.
	 * @return void
	 */
	public static function release( $lock ) {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session lock, nothing to cache.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::name( $lock ) ) );
	}

	/**
	 * Lock name, unique per site on a shared database server.
	 *
	 * @param string $lock Lock constant.
	 * @return string
	 */
	private static function name( $lock ) {
		global $wpdb;
		return $lock . '_' . md5( DB_NAME . $wpdb->prefix );
	}
}
