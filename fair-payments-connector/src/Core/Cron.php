<?php
/**
 * WP-Cron scheduling that checks its result.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Core;

defined( 'WPINC' ) || die;

/**
 * Schedules recurring WP-Cron events and confirms they exist.
 *
 * WordPress reports a refused event (an unregistered interval, a filter
 * vetoing it, a failed write of the cron option) only through its return
 * value, and a concurrent request may have added the same event first. Every
 * call reads the schedule back, so success means the event is in place. A
 * failure is logged with a sanitized code and returned; nothing records
 * success, so the next request that reconciles the schedule tries again.
 */
class Cron {
	public const CODE_LENGTH = 40;

	/**
	 * Make sure a recurring event exists, without moving an existing one.
	 *
	 * @param string $hook       Cron hook.
	 * @param string $recurrence Registered recurrence name.
	 * @param int    $first_run  Unix time of the first run when it is missing.
	 * @param array  $args       Event arguments.
	 * @return true|string True when the event exists, or a sanitized failure code.
	 */
	public static function ensure_recurring( $hook, $recurrence, $first_run, array $args = array() ) {
		if ( false !== wp_next_scheduled( $hook, $args ) ) {
			return true;
		}
		$result = wp_schedule_event( (int) $first_run, $recurrence, $hook, $args, true );
		if ( false !== wp_next_scheduled( $hook, $args ) ) {
			return true;
		}
		$code = substr( sanitize_key( is_wp_error( $result ) ? (string) $result->get_error_code() : '' ), 0, self::CODE_LENGTH );
		$code = '' !== $code ? $code : 'not_scheduled';
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- operators need to see a schedule that keeps failing.
		error_log( sprintf( 'Fair Payments Connector: could not schedule %1$s (%2$s); a later request tries again.', $hook, $code ) );
		return $code;
	}

	/**
	 * Remove every recurring event this plugin owns, whatever its arguments.
	 *
	 * The digest events are removed only while this plugin runs payment
	 * notifications: an older experimental release that still owns them keeps
	 * its schedule. Queued digest rows and settings stay, and are sent by
	 * their usual rules once the plugin is active again.
	 *
	 * @return void
	 */
	public static function deactivate() {
		\FairPaymentsConnector\Hooks\PaymentLogRetentionHooks::unschedule();
		if ( NotificationOwnership::is_owner() ) {
			\FairPaymentsConnector\Hooks\DigestHooks::unschedule();
		}
	}
}
