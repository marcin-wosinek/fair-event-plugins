<?php
/**
 * WP-Cron scheduling that checks its result.
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Core;

use FairAudienceExperimental\Hooks\InstagramCleanupHooks;
use FairAudienceExperimental\Hooks\ScheduledMessageHooks;

defined( 'WPINC' ) || die;

/**
 * Keeps this plugin's recurring events in step with its enabled bundles.
 *
 * On every request, after `init`, each enabled bundle's events are restored
 * when missing and each disabled bundle's events are removed, so turning a
 * bundle off stops its work and turning it on (or reactivating the plugin)
 * starts it again. Every attempt is read back; a failure is logged with a
 * sanitized code, and the next request tries again.
 */
class Cron {
	public const CODE_LENGTH = 40;

	/**
	 * Daily Instagram access-token refresh.
	 */
	public const INSTAGRAM_TOKEN_HOOK = 'fair_audience_refresh_instagram_token';

	/**
	 * Recurring events per bundle.
	 */
	public const BUNDLE_HOOKS = array(
		'messaging' => array( ScheduledMessageHooks::CRON_HOOK ),
		'instagram' => array( InstagramCleanupHooks::CRON_HOOK, self::INSTAGRAM_TOKEN_HOOK ),
	);

	/**
	 * Reconcile on `init`, after translations, so the five-minute interval
	 * Fair Audience registers is in place and its label can be translated.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'init', array( self::class, 'reconcile' ), 11 );
	}

	/**
	 * Schedule enabled bundles' events and remove disabled bundles' events.
	 *
	 * @return bool Whether every enabled bundle's events are scheduled.
	 */
	public static function reconcile() {
		$scheduled = true;
		foreach ( self::BUNDLE_HOOKS as $bundle => $hooks ) {
			if ( ! Features::is_enabled( $bundle ) ) {
				self::unschedule( $hooks );
				continue;
			}
			foreach ( $hooks as $hook ) {
				$scheduled = true === self::ensure_recurring( $hook, ...self::recurrence( $hook ) ) && $scheduled;
			}
		}
		return $scheduled;
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
		error_log( sprintf( 'Fair Audience Experimental: could not schedule %1$s (%2$s); a later request tries again.', $hook, $code ) );
		return $code;
	}

	/**
	 * Remove every event of the given hooks, whatever their arguments.
	 * WordPress writes the cron option only when something was removed.
	 *
	 * @param string[] $hooks Cron hooks.
	 * @return void
	 */
	public static function unschedule( array $hooks ) {
		foreach ( $hooks as $hook ) {
			wp_unschedule_hook( $hook );
		}
	}

	/**
	 * Remove every event this plugin owns. Pending scheduled messages,
	 * credentials and settings stay and are picked up again once it runs.
	 *
	 * @return void
	 */
	public static function deactivate() {
		foreach ( self::BUNDLE_HOOKS as $hooks ) {
			self::unschedule( $hooks );
		}
	}

	/**
	 * Recurrence and first run of a hook.
	 *
	 * @param string $hook Cron hook.
	 * @return array{0: string, 1: int}
	 */
	private static function recurrence( $hook ) {
		switch ( $hook ) {
			case ScheduledMessageHooks::CRON_HOOK:
				return array( ScheduledMessageHooks::INTERVAL, time() + MINUTE_IN_SECONDS );
			case InstagramCleanupHooks::CRON_HOOK:
				return array( 'hourly', time() + HOUR_IN_SECONDS );
			default:
				// Restoring the event (reactivation, bundle switched back on)
				// must not refresh the token on the spot: a token without a
				// known expiry would be swapped during that request. The
				// refresh only acts within 7 days of expiry, so a day's
				// delay is safe.
				return array( 'daily', time() + DAY_IN_SECONDS );
		}
	}
}
