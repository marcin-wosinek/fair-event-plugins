<?php
/**
 * WP-Cron lifecycle of weekly sends.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Core\Cron;

defined( 'WPINC' ) || die;

/**
 * Keeps one queued WP-Cron send per configuration of a weekly notification
 * type, and the bookkeeping that goes with it.
 *
 * Each send is queued on the type's hook with `array( $send_week, $config_id )`,
 * where the send week is the ISO week it goes out in, e.g. '2026-W41', fixed
 * when it is queued. Per configuration it stores the next send under the
 * `next_run` option and the send week last used under `last_sent_week`; a
 * send week that was used is never scheduled again.
 *
 * Recipient selection, composing and delivering the email stay with each
 * dispatcher, as do its delivery claims and history.
 */
class WeeklySendSchedule {

	/**
	 * Cron hook.
	 *
	 * @var string
	 */
	private $hook;

	/**
	 * Notification type, one of {@see Configurations::TYPES}.
	 *
	 * @var string
	 */
	private $type;

	/**
	 * Constructor.
	 *
	 * @param string $hook Cron hook.
	 * @param string $type Notification type.
	 */
	public function __construct( $hook, $type ) {
		$this->hook = $hook;
		$this->type = $type;
	}

	/**
	 * Queue an enabled configuration's next send if none is queued.
	 *
	 * Always the next future moment: a send missed while a plugin was
	 * inactive or being migrated is never replayed. A send that could not be
	 * queued records nothing, so the next request tries again.
	 *
	 * @param string $config_id Configuration ID.
	 * @param array  $settings  Its settings.
	 * @return void
	 */
	public function ensure( $config_id, array $settings ) {
		if ( ! $settings['enabled'] || $this->next_run( $config_id ) ) {
			return;
		}
		$this->schedule_next( $config_id, $settings, self::now() );
		// This request may have listed a configuration deleted meanwhile.
		ScheduledSends::drop_if_deleted( $this->hook, $config_id, $this->type );
	}

	/**
	 * The configuration ID a queued send is for.
	 *
	 * @param string $config_id Configuration ID; '' on sends queued before configurations had IDs.
	 * @return string
	 */
	public function config_id( $config_id ) {
		return '' === (string) $config_id ? Configurations::legacy_id( $this->type ) : (string) $config_id;
	}

	/**
	 * Start a queued send: queue the following one first, so a failure while
	 * sending never stops the weekly cycle.
	 *
	 * A deletion that finished meanwhile leaves nothing queued, and the send
	 * must not start. Once this returns true, the send runs to the end and
	 * records its outcome even if the configuration is deleted meanwhile.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param array              $settings  Its settings.
	 * @param \DateTimeImmutable $now       Current moment, in the site timezone.
	 * @return bool Whether the send may start.
	 */
	public function advance( $config_id, array $settings, \DateTimeImmutable $now ) {
		if ( $settings['enabled'] ) {
			$this->schedule_next( $config_id, $settings, $now );
		}
		return ! ScheduledSends::drop_if_deleted( $this->hook, $config_id, $this->type );
	}

	/**
	 * Replace a configuration's queued send after its settings change.
	 *
	 * @param string $config_id Configuration ID.
	 * @param array  $settings  Its new settings.
	 * @return void
	 */
	public function reschedule( $config_id, array $settings ) {
		$next = $this->next_run( $config_id );
		if ( $settings['enabled'] && $next && $next['timestamp'] <= time() ) {
			// A due send is waiting for WP-Cron. Keep it: when it runs, it
			// queues the following send from the new settings.
			return;
		}

		$this->unschedule( $config_id );
		if ( $settings['enabled'] ) {
			$this->schedule_next( $config_id, $settings, self::now() );
		}
	}

	/**
	 * Remove a configuration's queued sends and next send.
	 *
	 * @param string $config_id Configuration ID.
	 * @return void
	 */
	public function unschedule( $config_id ) {
		ScheduledSends::clear( $this->hook, $config_id );
		delete_option( Configurations::option( $config_id, 'next_run' ) );
	}

	/**
	 * Remove every queued send of the type.
	 *
	 * @return void
	 */
	public function unschedule_all() {
		wp_unschedule_hook( $this->hook );
		foreach ( Configurations::all( $this->type ) as $configuration ) {
			delete_option( Configurations::option( $configuration['id'], 'next_run' ) );
		}
	}

	/**
	 * A configuration's next send, if its cron event still exists.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array{timestamp: int, send_week: string}|null
	 */
	public function next_run( $config_id ) {
		$next = get_option( Configurations::option( $config_id, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['send_week'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( $this->hook, array( $next['send_week'], $config_id ) );

		return $timestamp
			? array(
				'timestamp' => (int) $timestamp,
				'send_week' => (string) $next['send_week'],
			)
			: null;
	}

	/**
	 * Record that a send week is used up, whatever the send's outcome.
	 *
	 * @param string $config_id Configuration ID.
	 * @param string $send_week ISO week, e.g. '2026-W41'.
	 * @return void
	 */
	public static function mark_sent( $config_id, $send_week ) {
		update_option( Configurations::option( $config_id, 'last_sent_week' ), $send_week, false );
	}

	/**
	 * The send week a configuration last used, or ''.
	 *
	 * @param string $config_id Configuration ID.
	 * @return string
	 */
	public static function last_sent_week( $config_id ) {
		return (string) get_option( Configurations::option( $config_id, 'last_sent_week' ), '' );
	}

	/**
	 * The first send moment after a moment whose send week is still open.
	 *
	 * @param array              $settings  Settings with `day_of_week` and `time_of_day`.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @param string             $last_sent Send week already used, or ''.
	 * @return \DateTimeImmutable
	 */
	public static function next_due( array $settings, \DateTimeImmutable $after, $last_sent ) {
		$due = WeekSchedule::next_due( $after, $settings['day_of_week'], $settings['time_of_day'] );
		if ( '' !== $last_sent && self::iso_week( $due ) === $last_sent ) {
			$due = WeekSchedule::next_due( $due, $settings['day_of_week'], $settings['time_of_day'] );
		}

		return $due;
	}

	/**
	 * ISO year-week identifier of a moment, e.g. '2026-W41'.
	 *
	 * @param \DateTimeInterface $moment A moment in the site timezone.
	 * @return string
	 */
	public static function iso_week( \DateTimeInterface $moment ) {
		return $moment->format( 'o' ) . '-W' . $moment->format( 'W' );
	}

	/**
	 * The Monday of an ISO week identifier.
	 *
	 * @param string $iso_week Identifier such as '2026-W41'.
	 * @return string|null 'Y-m-d', or null for an invalid identifier.
	 */
	public static function week_start( $iso_week ) {
		if ( ! preg_match( '/^(\d{4})-W(\d{2})$/', (string) $iso_week, $matches ) || (int) $matches[2] < 1 || (int) $matches[2] > 53 ) {
			return null;
		}

		return ( new \DateTimeImmutable( 'now', new \DateTimeZone( 'UTC' ) ) )
			->setISODate( (int) $matches[1], (int) $matches[2] )
			->format( 'Y-m-d' );
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
	 * Queue a configuration's first send after a moment.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param array              $settings  Its settings.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @return bool Whether the send is queued. On failure no next send is
	 *              recorded, so the next request's {@see self::ensure()} tries again.
	 */
	private function schedule_next( $config_id, array $settings, \DateTimeImmutable $after ) {
		$due  = self::next_due( $settings, $after, self::last_sent_week( $config_id ) );
		$week = self::iso_week( $due );

		if ( true !== Cron::ensure_single( $due->getTimestamp(), $this->hook, array( $week, $config_id ) ) ) {
			delete_option( Configurations::option( $config_id, 'next_run' ) );
			return false;
		}
		update_option(
			Configurations::option( $config_id, 'next_run' ),
			array(
				'timestamp' => $due->getTimestamp(),
				'send_week' => $week,
			),
			false
		);
		return true;
	}
}
