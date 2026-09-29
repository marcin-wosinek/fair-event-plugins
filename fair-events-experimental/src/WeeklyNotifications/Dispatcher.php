<?php
/**
 * Weekly notification scheduling and delivery.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per send and delivers the summary it covers.
 *
 * Each scheduled event carries the first day of the week it covers, fixed
 * when it was scheduled, so a late run still sends the intended week. The
 * worker runs in the background cron request, never in an administrator or
 * visitor request.
 */
class Dispatcher {
	public const HOOK             = 'fair_events_experimental_weekly_notification';
	public const NEXT_RUN_OPTION  = 'fair_events_experimental_weekly_notification_next_run';
	public const RUNS_OPTION      = 'fair_events_experimental_weekly_notification_runs';
	private const RUN_HISTORY_MAX = 10;

	/**
	 * Delivery record.
	 *
	 * @var DeliveryLog
	 */
	private $log;

	/**
	 * Providers keyed by ID.
	 *
	 * @var array<string, Provider>
	 */
	private $providers;

	/**
	 * Summary builder.
	 *
	 * @var SummaryBuilder
	 */
	private $builder;

	/**
	 * Constructor.
	 *
	 * @param DeliveryLog|null    $log       Delivery record.
	 * @param Provider[]|null     $providers Providers keyed by ID.
	 * @param SummaryBuilder|null $builder   Summary builder.
	 */
	public function __construct( $log = null, $providers = null, $builder = null ) {
		$this->log       = $log ? $log : new DeliveryLog();
		$this->providers = null !== $providers ? $providers : Providers::all();
		$this->builder   = $builder ? $builder : new SummaryBuilder();
	}

	/**
	 * Register the cron worker and keep the next send scheduled.
	 *
	 * @return void
	 */
	public static function init() {
		DeliveryLog::maybe_install();
		add_action( self::HOOK, array( self::class, 'handle' ) );

		$settings = WeeklyNotificationSettings::get();
		if ( $settings['enabled'] && ! self::next_run() ) {
			self::schedule_next( $settings, self::now() );
		}
	}

	/**
	 * Cron callback.
	 *
	 * @param string $week_start First day of the covered week, fixed at scheduling time.
	 * @return void
	 */
	public static function handle( $week_start ) {
		$settings = WeeklyNotificationSettings::get();
		$now      = self::now();

		// Schedule the following send first, so a failure below never stops
		// the weekly cycle.
		if ( $settings['enabled'] ) {
			self::schedule_next( $settings, $now );
		}

		$dispatcher = new self();
		$dispatcher->process( (string) $week_start, $settings, $now );
		$dispatcher->log->cleanup();
	}

	/**
	 * Replace the scheduled send after settings change.
	 *
	 * @param array $settings Weekly notification settings.
	 * @return void
	 */
	public static function reschedule( array $settings ) {
		$next = self::next_run();
		if ( $settings['enabled'] && $next && $next['timestamp'] <= time() ) {
			// A due send is waiting for WP-Cron. Keep it: when it runs, it schedules the
			// following send from the new settings.
			return;
		}

		wp_unschedule_hook( self::HOOK );
		delete_option( self::NEXT_RUN_OPTION );
		if ( $settings['enabled'] ) {
			self::schedule_next( $settings, self::now() );
		}
	}

	/**
	 * The scheduled send, if its cron event still exists.
	 *
	 * @return array{timestamp: int, week_start: string}|null
	 */
	public static function next_run() {
		$next = get_option( self::NEXT_RUN_OPTION, null );
		if ( ! is_array( $next ) || empty( $next['week_start'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['week_start'] ) );

		return $timestamp
			? array(
				'timestamp'  => (int) $timestamp,
				'week_start' => (string) $next['week_start'],
			)
			: null;
	}

	/**
	 * Schedule the first send after a moment.
	 *
	 * @param array              $settings Weekly notification settings.
	 * @param \DateTimeImmutable $after    Reference moment, in the site timezone.
	 * @return void
	 */
	private static function schedule_next( array $settings, \DateTimeImmutable $after ) {
		$due  = WeekSchedule::next_due( $after, $settings['day_of_week'], $settings['time_of_day'] );
		$week = WeekSchedule::target_week( $due, $settings['week_scope'], self::start_of_week() );
		$args = array( $week['start'] );

		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			wp_schedule_single_event( $due->getTimestamp(), self::HOOK, $args );
		}
		update_option(
			self::NEXT_RUN_OPTION,
			array(
				'timestamp'  => $due->getTimestamp(),
				'week_start' => $week['start'],
			),
			false
		);
	}

	/**
	 * Deliver the summary for a week to every active destination.
	 *
	 * @param string             $week_start First day of the covered week.
	 * @param array              $settings   Weekly notification settings.
	 * @param \DateTimeImmutable $now        Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $week_start, array $settings, \DateTimeImmutable $now ) {
		$week = WeekSchedule::week_from_start( $week_start );
		if ( ! $week || ! $settings['enabled'] ) {
			return null;
		}

		if ( WeekSchedule::has_ended( $week, $now ) ) {
			return $this->record( $week, 'expired', __( 'Not sent: the week had already ended when the scheduled send ran.', 'fair-events-experimental' ) );
		}

		$summary = $this->builder->build( $settings, $week );
		if ( is_wp_error( $summary ) ) {
			return $this->record( $week, 'configuration_error', $summary->get_error_message() );
		}

		if ( 0 === $summary['occurrence_count'] ) {
			return $this->record( $week, 'skipped_empty', __( 'No events this week, so nothing was sent.', 'fair-events-experimental' ) );
		}

		$counts = array(
			'sent'      => 0,
			'failed'    => 0,
			'uncertain' => 0,
			'duplicate' => 0,
		);
		foreach ( $this->providers as $provider ) {
			foreach ( $provider->destinations( $settings ) as $destination ) {
				++$counts[ $this->deliver( $provider, (string) $destination, $week['start'], $summary['text'] ) ];
			}
		}

		$attempted = $counts['sent'] + $counts['failed'] + $counts['uncertain'];
		if ( 0 === $attempted && $counts['duplicate'] > 0 ) {
			// An overlapping run already handled every destination; its record stands.
			return null;
		}
		if ( 0 === $attempted ) {
			return $this->record( $week, 'configuration_error', __( 'No delivery destination is enabled and configured.', 'fair-events-experimental' ) );
		}

		if ( $counts['sent'] === $attempted ) {
			$status = 'sent';
		} elseif ( $counts['sent'] > 0 ) {
			$status = 'partial';
		} else {
			$status = 'failed';
		}

		return $this->record(
			$week,
			$status,
			sprintf(
				/* translators: 1: destinations delivered, 2: destinations failed, 3: destinations with an unknown outcome */
				__( 'Delivered: %1$d. Failed: %2$d. Unknown outcome: %3$d.', 'fair-events-experimental' ),
				$counts['sent'],
				$counts['failed'],
				$counts['uncertain']
			),
			$counts
		);
	}

	/**
	 * Deliver every part of the summary to one destination, in order.
	 *
	 * Only the run that claims part 1 sends to the destination. After a part
	 * fails or has an unknown outcome, the remaining parts are recorded as
	 * skipped rather than sent out of order; nothing is resent automatically.
	 *
	 * @param Provider $provider    Provider.
	 * @param string   $destination Destination identifier.
	 * @param string   $week_start  First day of the covered week.
	 * @param string   $text        Summary text.
	 * @return string 'sent', 'failed', 'uncertain' or 'duplicate'.
	 */
	private function deliver( Provider $provider, $destination, $week_start, $text ) {
		$provider_id = $provider->id();
		$claimed     = 0;

		try {
			$parts = $provider->split( $text );
			$count = count( $parts );
			if ( ! $this->log->claim( $week_start, $provider_id, $destination, 1, $count ) ) {
				return 'duplicate';
			}

			foreach ( $parts as $index => $part_text ) {
				$part = $index + 1;
				if ( $part > 1 && ! $this->log->claim( $week_start, $provider_id, $destination, $part, $count ) ) {
					continue;
				}
				$claimed = $part;

				$result = $provider->send( $destination, $part_text );
				$this->log->finish( $week_start, $provider_id, $destination, $part, $result );
				$claimed = 0;

				if ( 'sent' !== $result['state'] ) {
					for ( $rest = $part + 1; $rest <= $count; $rest++ ) {
						$this->log->claim( $week_start, $provider_id, $destination, $rest, $count, 'skipped', 'previous_part_not_sent' );
					}
					return $result['state'];
				}
			}

			return 'sent';
		} catch ( \Throwable $e ) {
			// The provider may have been contacted before the error, so a
			// claimed part's outcome is unknown; it is never resent.
			$result = array(
				'state'   => $claimed ? 'uncertain' : 'failed',
				'code'    => 'internal_error',
				'message' => '',
			);
			if ( $claimed ) {
				$this->log->finish( $week_start, $provider_id, $destination, $claimed, $result );
			} else {
				$this->log->claim( $week_start, $provider_id, $destination, 1, 1, 'failed', 'internal_error' );
			}
			return $result['state'];
		}
	}

	/**
	 * Store the outcome of a run, one entry per covered week.
	 *
	 * @param array{start: string, end: string} $week    Week boundaries.
	 * @param string                            $status  Run status.
	 * @param string                            $message Human-readable detail.
	 * @param array                             $counts  Destination outcome counts.
	 * @return array The run record.
	 */
	private function record( array $week, $status, $message, array $counts = array() ) {
		$run = array(
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'status'     => $status,
			'message'    => $message,
			'counts'     => $counts,
			'time'       => current_time( 'mysql', true ),
		);

		$runs = get_option( self::RUNS_OPTION, array() );
		$runs = is_array( $runs ) ? $runs : array();
		unset( $runs[ $week['start'] ] );
		$runs = array( $week['start'] => $run ) + $runs;
		update_option( self::RUNS_OPTION, array_slice( $runs, 0, self::RUN_HISTORY_MAX, true ), false );

		return $run;
	}

	/**
	 * Recorded runs, newest first.
	 *
	 * @return array[]
	 */
	public static function runs() {
		$runs = get_option( self::RUNS_OPTION, array() );
		return is_array( $runs ) ? array_values( $runs ) : array();
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
	 * The site's first weekday, from Sunday (0) to Saturday (6).
	 *
	 * @return int
	 */
	public static function start_of_week() {
		return (int) get_option( 'start_of_week', 1 );
	}
}
