<?php
/**
 * WP-Cron scheduling that checks its result.
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

defined( 'WPINC' ) || die;

/**
 * Schedules WP-Cron events and confirms they exist.
 *
 * WordPress reports a refused event (an unknown recurrence, a filter vetoing
 * it, a failed write of the cron option) only through its return value, and a
 * concurrent request may have added the same event first. Every call reads the
 * schedule back, so success means the event is in place. A failure is logged
 * with a sanitized code and returned; nothing records success, so the next
 * request that reconciles the schedule tries again.
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
		return self::verify( $hook, $args, wp_schedule_event( (int) $first_run, $recurrence, $hook, $args, true ) );
	}

	/**
	 * Make sure a one-off event with these arguments exists.
	 *
	 * @param int    $timestamp Unix time it runs when it is missing.
	 * @param string $hook      Cron hook.
	 * @param array  $args      Event arguments.
	 * @return true|string True when the event exists, or a sanitized failure code.
	 */
	public static function ensure_single( $timestamp, $hook, array $args = array() ) {
		if ( false !== wp_next_scheduled( $hook, $args ) ) {
			return true;
		}
		return self::verify( $hook, $args, wp_schedule_single_event( (int) $timestamp, $hook, $args, true ) );
	}

	/**
	 * Remove every recurring or pending event this plugin owns.
	 *
	 * Settings, history and queued business data stay.
	 *
	 * @return void
	 */
	public static function deactivate() {
		\FairEvents\Notifications\Notifications::deactivate();
		\FairEvents\Hooks\PaymentHooks::unschedule();
		\FairEvents\Services\TicketBackfill::unschedule();
	}

	/**
	 * Read the schedule back after an attempt.
	 *
	 * @param string $hook   Cron hook.
	 * @param array  $args   Event arguments.
	 * @param mixed  $result What WordPress returned.
	 * @return true|string
	 */
	private static function verify( $hook, array $args, $result ) {
		if ( false !== wp_next_scheduled( $hook, $args ) ) {
			return true;
		}
		$code = substr( sanitize_key( is_wp_error( $result ) ? (string) $result->get_error_code() : '' ), 0, self::CODE_LENGTH );
		$code = '' !== $code ? $code : 'not_scheduled';
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- operators need to see a schedule that keeps failing.
		error_log( sprintf( 'Fair Events: could not schedule %1$s (%2$s); a later request tries again.', $hook, $code ) );
		return $code;
	}
}
