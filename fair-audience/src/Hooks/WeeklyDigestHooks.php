<?php
/**
 * Weekly Digest Hooks
 *
 * Drives the weekly events digest: a 5-minute cron tick checks whether the
 * configured send day/time has arrived and dispatches at most once per ISO
 * week, guarded by the `fair_audience_weekly_digest_last_sent_week` option.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Services\EmailService;
use FairAudience\Services\EmailType;
use FairAudience\Services\WeeklyDigestRenderer;

defined( 'WPINC' ) || die;

/**
 * Cron hooks for the weekly events digest sender.
 */
class WeeklyDigestHooks {

	/**
	 * Cron hook name for the recurring tick.
	 */
	const CRON_HOOK = 'fair_audience_weekly_digest_tick';

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );

		add_action( self::CRON_HOOK, array( static::class, 'run_due' ) );
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fair_audience_every_five_minutes', self::CRON_HOOK );
		}
	}

	/**
	 * Register the shared 5-minute cron schedule.
	 *
	 * Mirrors ScheduledMessageHooks::add_cron_schedule so both coexist; the
	 * `isset()` guard makes adding the same key twice a no-op.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules['fair_audience_every_five_minutes'] ) ) {
			$schedules['fair_audience_every_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience' ),
			);
		}
		return $schedules;
	}

	/**
	 * Cron tick: send the digest if it's enabled, due, and not already sent
	 * for the current ISO week.
	 */
	public static function run_due() {
		$config = get_option( 'fair_audience_weekly_digest', WeeklyDigestRenderer::default_config() );

		if ( empty( $config['enabled'] ) || empty( $config['source_slug'] ) ) {
			return;
		}

		if ( ! class_exists( 'FairEvents\Services\WeeklyEventsProvider' ) ) {
			return;
		}

		$now              = new \DateTime( 'now', wp_timezone() );
		$current_iso_week = self::iso_week( $now );

		if ( get_option( 'fair_audience_weekly_digest_last_sent_week', '' ) === $current_iso_week ) {
			return;
		}

		if ( ! self::is_due( $now, (int) $config['day_of_week'], $config['time_of_day'] ) ) {
			return;
		}

		// Write the guard before dispatch: a mid-send crash must not resend on
		// the next tick, mirroring the at-most-once contract of ScheduledMessageHooks.
		update_option( 'fair_audience_weekly_digest_last_sent_week', $current_iso_week );

		self::dispatch( $config );
	}

	/**
	 * Whether now (site tz) has reached this week's configured day/time.
	 *
	 * @param \DateTime $now         Current time in site timezone.
	 * @param int       $day_of_week ISO day of week (1=Monday..7=Sunday).
	 * @param string    $time_of_day 'HH:MM'.
	 * @return bool
	 */
	private static function is_due( \DateTime $now, $day_of_week, $time_of_day ) {
		return $now >= self::due_moment( $now, $day_of_week, $time_of_day );
	}

	/**
	 * The exact moment this week's configured day/time falls on.
	 *
	 * @param \DateTime $now         Current time in site timezone.
	 * @param int       $day_of_week ISO day of week (1=Monday..7=Sunday).
	 * @param string    $time_of_day 'HH:MM'.
	 * @return \DateTime
	 */
	public static function due_moment( \DateTime $now, $day_of_week, $time_of_day ) {
		list( $hour, $minute ) = array_map( 'intval', explode( ':', $time_of_day ) );

		$due = clone $now;
		$due->setISODate( (int) $now->format( 'o' ), (int) $now->format( 'W' ), $day_of_week );
		$due->setTime( $hour, $minute, 0 );

		return $due;
	}

	/**
	 * ISO year-week identifier for the given moment, e.g. "2026-W29".
	 *
	 * @param \DateTime $now A moment in time.
	 * @return string
	 */
	public static function iso_week( \DateTime $now ) {
		return $now->format( 'o' ) . '-W' . $now->format( 'W' );
	}

	/**
	 * Render and send the digest, recording the outcome.
	 *
	 * @param array $config Sanitized digest config.
	 */
	private static function dispatch( array $config ) {
		try {
			list( $year, $week_num ) = WeeklyDigestRenderer::resolve_week_scope( $config['week_scope'] );

			$provider = new \FairEvents\Services\WeeklyEventsProvider();
			$week     = $provider->get_week( $config['source_slug'], $year, $week_num );

			if ( is_wp_error( $week ) ) {
				self::record_result( 'failed', $week->get_error_message() );
				return;
			}

			if ( ! empty( $config['skip_empty'] ) && WeeklyDigestRenderer::is_week_empty( $week ) ) {
				self::record_result( 'skipped', __( 'No events scheduled this week.', 'fair-audience' ) );
				return;
			}

			$subject = WeeklyDigestRenderer::render_subject( $config['subject'], $week );
			$html    = WeeklyDigestRenderer::render( $week, $config['intro'], $config['outro'] );

			$email_service = new EmailService();
			$results       = $email_service->send_bulk_custom_mail_to_all( $subject, $html, true, array(), array(), EmailType::WEEKLY_SUMMARY );

			self::record_result(
				'sent',
				sprintf(
					/* translators: 1: sent count, 2: failed count, 3: skipped count */
					__( 'Sent to %1$d, failed %2$d, skipped %3$d.', 'fair-audience' ),
					count( $results['sent'] ),
					count( $results['failed'] ),
					count( $results['skipped'] )
				)
			);
		} catch ( \Throwable $e ) {
			self::record_result( 'failed', $e->getMessage() );
		}
	}

	/**
	 * Persist the outcome of the last cron run.
	 *
	 * @param string $status  'sent', 'failed', or 'skipped'.
	 * @param string $message Human-readable detail.
	 */
	private static function record_result( $status, $message ) {
		update_option(
			'fair_audience_weekly_digest_last_run_result',
			array(
				'status'    => $status,
				'timestamp' => current_time( 'mysql' ),
				'message'   => $message,
			)
		);
	}
}
