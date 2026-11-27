<?php
/**
 * WP-Cron lifecycle of sharing reminders.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Keeps one queued WP-Cron event per enabled sharing reminder.
 *
 * Each event runs {@see self::HOOK} with `array( $send_week, $source_id )`,
 * where the send week is the ISO week of the scheduled moment, fixed when it
 * is queued. The next run is also kept in the reminder's `next_run` option,
 * so it can be shown and replaced.
 *
 * The weekday and time are wall-clock values in the site timezone, computed
 * by Fair Events' {@see \FairEvents\Notifications\WeekSchedule}, the same
 * arithmetic Event notifications use. A run missed while the plugin or the
 * feature was off is never replayed: only the next future moment is queued.
 */
class ReminderSchedule {
	public const HOOK = 'fair_events_experimental_whatsapp_reminder';

	/**
	 * Queue an enabled reminder's next run if none is queued.
	 *
	 * @param int   $source_id Event feed ID.
	 * @param array $reminder  Normalized reminder.
	 * @return void
	 */
	public static function ensure( $source_id, array $reminder ) {
		if ( ! $reminder['enabled'] || self::next_run( $source_id ) ) {
			return;
		}
		self::schedule_next( $source_id, $reminder, self::now() );
	}

	/**
	 * Replace a reminder's queued run after its settings changed.
	 *
	 * @param int        $source_id Event feed ID.
	 * @param array|null $reminder  Normalized reminder, or null once removed.
	 * @return void
	 */
	public static function reschedule( $source_id, $reminder ) {
		self::unschedule( $source_id );
		if ( $reminder && $reminder['enabled'] ) {
			self::schedule_next( $source_id, $reminder, self::now() );
		}
	}

	/**
	 * Queue the run after the one starting now, so a failure while sending
	 * never stops the weekly cycle.
	 *
	 * @param int                $source_id Event feed ID.
	 * @param array              $reminder  Normalized reminder.
	 * @param \DateTimeImmutable $now       Current moment, in the site timezone.
	 * @return void
	 */
	public static function advance( $source_id, array $reminder, \DateTimeImmutable $now ) {
		delete_option( SharingReminders::option( $source_id, 'next_run' ) );
		if ( $reminder['enabled'] ) {
			self::schedule_next( $source_id, $reminder, $now );
		}
	}

	/**
	 * Remove a reminder's queued run.
	 *
	 * @param int $source_id Event feed ID.
	 * @return void
	 */
	public static function unschedule( $source_id ) {
		$next = get_option( SharingReminders::option( $source_id, 'next_run' ), null );
		if ( is_array( $next ) && ! empty( $next['send_week'] ) ) {
			wp_clear_scheduled_hook( self::HOOK, array( (string) $next['send_week'], absint( $source_id ) ) );
		}
		delete_option( SharingReminders::option( $source_id, 'next_run' ) );
	}

	/**
	 * Remove every queued reminder run and their next-run records.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::HOOK );
		foreach ( SharingReminders::ids() as $source_id ) {
			delete_option( SharingReminders::option( $source_id, 'next_run' ) );
		}
	}

	/**
	 * Queue every enabled reminder's next run that is missing, e.g. after
	 * the feature was turned back on.
	 *
	 * @return void
	 */
	public static function ensure_all() {
		foreach ( SharingReminders::ids() as $source_id ) {
			$reminder = SharingReminders::get( $source_id );
			if ( $reminder ) {
				self::ensure( $source_id, $reminder );
			}
		}
	}

	/**
	 * A reminder's next run, while its cron event still exists.
	 *
	 * @param int $source_id Event feed ID.
	 * @return array{timestamp: int, send_week: string}|null
	 */
	public static function next_run( $source_id ) {
		$next = get_option( SharingReminders::option( $source_id, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['send_week'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( (string) $next['send_week'], absint( $source_id ) ) );
		return $timestamp
			? array(
				'timestamp' => (int) $timestamp,
				'send_week' => (string) $next['send_week'],
			)
			: null;
	}

	/**
	 * Whether Fair Events provides the schedule arithmetic.
	 *
	 * @return bool
	 */
	public static function available() {
		return class_exists( '\FairEvents\Notifications\WeekSchedule' ) && method_exists( '\FairEvents\Notifications\WeekSchedule', 'next_due' );
	}

	/**
	 * ISO year-week of a moment, e.g. '2026-W48'.
	 *
	 * @param \DateTimeInterface $moment A moment in the site timezone.
	 * @return string
	 */
	public static function iso_week( \DateTimeInterface $moment ) {
		return $moment->format( 'o' ) . '-W' . $moment->format( 'W' );
	}

	/**
	 * The current moment in the site timezone.
	 *
	 * @return \DateTimeImmutable
	 */
	public static function now() {
		return new \DateTimeImmutable( 'now', wp_timezone() );
	}

	/**
	 * Queue a reminder's first run after a moment.
	 *
	 * @param int                $source_id Event feed ID.
	 * @param array              $reminder  Normalized reminder.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @return bool Whether the run is queued. On failure nothing is recorded,
	 *     so the next {@see self::ensure()} tries again.
	 */
	private static function schedule_next( $source_id, array $reminder, \DateTimeImmutable $after ) {
		if ( ! self::available() ) {
			return false;
		}
		$due  = \FairEvents\Notifications\WeekSchedule::next_due( $after, $reminder['day_of_week'], $reminder['time_of_day'] );
		$week = self::iso_week( $due );
		$args = array( $week, absint( $source_id ) );

		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			wp_schedule_single_event( $due->getTimestamp(), self::HOOK, $args );
		}
		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- operators need to see a schedule that keeps failing.
			error_log( sprintf( 'Fair Events Experimental: could not schedule the WhatsApp sharing reminder of feed %d; a later request tries again.', absint( $source_id ) ) );
			delete_option( SharingReminders::option( $source_id, 'next_run' ) );
			return false;
		}
		update_option(
			SharingReminders::option( $source_id, 'next_run' ),
			array(
				'timestamp' => $due->getTimestamp(),
				'send_week' => $week,
			),
			false
		);
		return true;
	}
}
