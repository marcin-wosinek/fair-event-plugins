<?php
/**
 * WP-Cron scheduling that checks its result.
 *
 * @package FairAudience
 */

namespace FairAudience\Core;

defined( 'WPINC' ) || die;

/**
 * Registers this plugin's cron interval and schedules events that are
 * confirmed to exist.
 *
 * WordPress refuses a recurring event whose interval is not registered yet,
 * so the interval filter is added before anything schedules with it. The
 * result of every attempt is read back: a concurrent request may have added
 * the same event first. A failure is logged with a sanitized code and
 * returned; nothing records success, so the next request that reconciles the
 * schedule tries again.
 */
class Cron {
	/**
	 * Five-minute interval, also registered by Fair Audience Experimental.
	 */
	public const EVERY_FIVE_MINUTES = 'fair_audience_every_five_minutes';

	public const CODE_LENGTH = 40;

	/**
	 * Recurring events this plugin owns, removed on deactivation.
	 *
	 * Deferred emails ({@see \FairAudience\Services\EmailService::DEFERRED_EMAIL_HOOK})
	 * are one-off sends carrying queued messages, so they stay.
	 */
	public const OWNED_HOOKS = array(
		\FairAudience\Hooks\PaymentHooks::CLEANUP_HOOK,
		\FairAudience\Hooks\PendingSubscriptionTimeoutHooks::CRON_HOOK,
		// Former weekly events email, now scheduled by Fair Events.
		\FairAudience\Services\WeeklyDigestMailer::LEGACY_CRON_HOOK,
	);

	/**
	 * Register the five-minute interval. Safe to call more than once.
	 *
	 * @return void
	 */
	public static function register_interval() {
		if ( false === has_filter( 'cron_schedules', array( self::class, 'add_interval' ) ) ) {
			// phpcs:ignore WordPress.WP.CronInterval.CronSchedulesInterval -- signup holds expire within minutes.
			add_filter( 'cron_schedules', array( self::class, 'add_interval' ) );
		}
	}

	/**
	 * Add the five-minute interval unless another plugin already did.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_interval( $schedules ) {
		if ( ! isset( $schedules[ self::EVERY_FIVE_MINUTES ] ) ) {
			$schedules[ self::EVERY_FIVE_MINUTES ] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience' ),
			);
		}
		return $schedules;
	}

	/**
	 * Make sure a recurring event exists, without moving an existing one.
	 *
	 * @param string $hook       Cron hook.
	 * @param string $recurrence Registered recurrence name.
	 * @param int    $first_run  Unix time of the first run when it is missing.
	 * @return true|string True when the event exists, or a sanitized failure code.
	 */
	public static function ensure_recurring( $hook, $recurrence, $first_run ) {
		if ( false !== wp_next_scheduled( $hook ) ) {
			return true;
		}
		$result = wp_schedule_event( (int) $first_run, $recurrence, $hook, array(), true );
		if ( false !== wp_next_scheduled( $hook ) ) {
			return true;
		}
		$code = substr( sanitize_key( is_wp_error( $result ) ? (string) $result->get_error_code() : '' ), 0, self::CODE_LENGTH );
		$code = '' !== $code ? $code : 'not_scheduled';
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- operators need to see a schedule that keeps failing.
		error_log( sprintf( 'Fair Audience: could not schedule %1$s (%2$s); a later request tries again.', $hook, $code ) );
		return $code;
	}

	/**
	 * Remove every recurring event this plugin owns, whatever its arguments.
	 *
	 * Settings, consent history and pending data stay; the events are
	 * restored on the first request after reactivation.
	 *
	 * @return void
	 */
	public static function deactivate() {
		foreach ( self::OWNED_HOOKS as $hook ) {
			wp_unschedule_hook( $hook );
		}
	}
}
