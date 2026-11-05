<?php
/**
 * WP-Cron scheduling that checks its result.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Schedules this plugin's recurring events, confirms they exist, and removes
 * them when the plugin or a feature stops.
 *
 * Every attempt is read back: a concurrent request may have added the same
 * event first. A failure is logged with a sanitized code and returned;
 * nothing records success, so the next request that reconciles the schedule
 * tries again. Meta delivery wake-ups keep their own reconciliation and
 * administrator diagnostics ({@see \FairEventsExperimental\Meta\DeliverySchedule}).
 */
class Cron {
	public const CODE_LENGTH = 40;

	/**
	 * Recurring and wake-up events of the Meta integration.
	 */
	public const META_HOOKS = array(
		\FairEventsExperimental\Meta\Conversions::DELIVERY_HOOK,
		\FairEventsExperimental\Meta\Conversions::CLEANUP_HOOK,
	);

	/**
	 * Every event this plugin owns, removed on deactivation.
	 */
	public const OWNED_HOOKS = array(
		\FairEventsExperimental\Meta\Conversions::DELIVERY_HOOK,
		\FairEventsExperimental\Meta\Conversions::CLEANUP_HOOK,
		\FairEventsExperimental\WhatsApp\Deliveries::CLEANUP_HOOK,
		// Cron event of the former weekly notification sender.
		'fair_events_experimental_weekly_notification',
	);

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
		error_log( sprintf( 'Fair Events Experimental: could not schedule %1$s (%2$s); a later request tries again.', $hook, $code ) );
		return $code;
	}

	/**
	 * Remove every event of the given hooks, whatever their arguments.
	 * Cheap to call on every request: WordPress writes the cron option only
	 * when something was removed.
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
	 * Stop everything this plugin schedules. Outbox rows, delivery records,
	 * credentials and settings stay; queued Meta work is picked up again by
	 * its usual reconciliation once the plugin runs again.
	 *
	 * @return void
	 */
	public static function deactivate() {
		self::unschedule( self::OWNED_HOOKS );
		delete_option( 'fair_events_experimental_weekly_notification_next_run' );
		\FairEventsExperimental\Frontend\WeeklySummaryPage::deactivate();
	}
}
