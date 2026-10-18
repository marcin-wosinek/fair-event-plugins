<?php
/**
 * Weekly notification scheduling and delivery.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per send of each Telegram configuration and
 * delivers the summary it covers.
 *
 * Each scheduled event carries the first day of the week it covers, fixed
 * when it was scheduled, and the configuration ID, so a late run still sends
 * the intended week of the intended configuration. Each configuration keeps
 * its own next send, history and delivery records. The worker runs in the
 * background cron request, never in an administrator or visitor request.
 */
class TelegramDispatcher {
	public const HOOK = 'fair_events_notification_telegram';
	// Where the single configuration kept its state before configurations had
	// IDs. Read only when migrating it.
	public const LEGACY_NEXT_RUN_OPTION = 'fair_events_notification_telegram_next_run';
	public const LEGACY_RUNS_OPTION     = 'fair_events_notification_telegram_runs';
	private const RUN_HISTORY_MAX       = 10;

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
	 * Register the cron worker and keep each configuration's next send scheduled.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ), 10, 2 );

		foreach ( Configurations::all( Configurations::TELEGRAM ) as $configuration ) {
			$settings = TelegramSettings::get( $configuration['id'] );
			if ( $settings['enabled'] && ! self::next_run( $configuration['id'] ) ) {
				// Always the next future moment: a send missed while the plugin
				// was inactive or being migrated is never replayed.
				self::schedule_next( $configuration['id'], $settings, self::now() );
			}
		}
	}

	/**
	 * Remove one configuration's scheduled sends.
	 *
	 * @param string $config_id Configuration ID.
	 * @return void
	 */
	public static function unschedule( $config_id ) {
		ScheduledSends::clear( self::HOOK, $config_id );
		delete_option( Configurations::option( $config_id, 'next_run' ) );
	}

	/**
	 * Remove every configuration's scheduled sends, e.g. when the plugin is deactivated.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::HOOK );
		foreach ( Configurations::all( Configurations::TELEGRAM ) as $configuration ) {
			delete_option( Configurations::option( $configuration['id'], 'next_run' ) );
		}
	}

	/**
	 * Cron callback.
	 *
	 * @param string $week_start First day of the covered week, fixed at scheduling time.
	 * @param string $config_id  Configuration ID; absent on sends queued before configurations had IDs.
	 * @return void
	 */
	public static function handle( $week_start, $config_id = '' ) {
		$config_id = '' === (string) $config_id ? Configurations::legacy_id( Configurations::TELEGRAM ) : (string) $config_id;
		if ( ! Configurations::exists( $config_id, Configurations::TELEGRAM ) ) {
			return;
		}
		$settings = TelegramSettings::get( $config_id );
		$now      = self::now();

		// Schedule the following send first, so a failure below never stops
		// the weekly cycle.
		if ( $settings['enabled'] ) {
			self::schedule_next( $config_id, $settings, $now );
		}

		$dispatcher = new self();
		$dispatcher->process( $config_id, (string) $week_start, $settings, $now );
		$dispatcher->log->cleanup();
	}

	/**
	 * Replace one configuration's scheduled send after its settings change.
	 *
	 * @param string $config_id Configuration ID.
	 * @param array  $settings  Its settings.
	 * @return void
	 */
	public static function reschedule( $config_id, array $settings ) {
		$next = self::next_run( $config_id );
		if ( $settings['enabled'] && $next && $next['timestamp'] <= time() ) {
			// A due send is waiting for WP-Cron. Keep it: when it runs, it schedules the
			// following send from the new settings.
			return;
		}

		self::unschedule( $config_id );
		if ( $settings['enabled'] ) {
			self::schedule_next( $config_id, $settings, self::now() );
		}
	}

	/**
	 * A configuration's scheduled send, if its cron event still exists.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array{timestamp: int, week_start: string}|null
	 */
	public static function next_run( $config_id ) {
		$next = get_option( Configurations::option( $config_id, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['week_start'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['week_start'], $config_id ) );

		return $timestamp
			? array(
				'timestamp'  => (int) $timestamp,
				'week_start' => (string) $next['week_start'],
			)
			: null;
	}

	/**
	 * Schedule a configuration's first send after a moment.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param array              $settings  Its settings.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @return void
	 */
	private static function schedule_next( $config_id, array $settings, \DateTimeImmutable $after ) {
		$due  = WeekSchedule::next_due( $after, $settings['day_of_week'], $settings['time_of_day'] );
		$week = WeekSchedule::target_week( $due, $settings['week_scope'], self::start_of_week() );
		$args = array( $week['start'], $config_id );

		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			wp_schedule_single_event( $due->getTimestamp(), self::HOOK, $args );
		}
		update_option(
			Configurations::option( $config_id, 'next_run' ),
			array(
				'timestamp'  => $due->getTimestamp(),
				'week_start' => $week['start'],
			),
			false
		);
	}

	/**
	 * Deliver one configuration's summary for a week to every active destination.
	 *
	 * @param string             $config_id  Configuration ID.
	 * @param string             $week_start First day of the covered week.
	 * @param array              $settings   Weekly notification settings.
	 * @param \DateTimeImmutable $now        Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $config_id, $week_start, array $settings, \DateTimeImmutable $now ) {
		$week = WeekSchedule::week_from_start( $week_start );
		if ( ! $week || ! $settings['enabled'] ) {
			return null;
		}

		if ( WeekSchedule::has_ended( $week, $now ) ) {
			return $this->record( $config_id, $week, 'expired', __( 'Not sent: the week had already ended when the scheduled send ran.', 'fair-events' ) );
		}

		$summary = $this->builder->build( $settings, $week );
		if ( is_wp_error( $summary ) ) {
			return $this->record( $config_id, $week, 'configuration_error', $summary->get_error_message() );
		}

		if ( 0 === $summary['occurrence_count'] ) {
			return $this->record( $config_id, $week, 'skipped_empty', __( 'No events this week, so nothing was sent.', 'fair-events' ) );
		}

		$counts = array(
			'sent'      => 0,
			'failed'    => 0,
			'uncertain' => 0,
			'duplicate' => 0,
		);
		foreach ( $this->providers as $provider ) {
			foreach ( $provider->destinations( $settings ) as $destination ) {
				++$counts[ $this->deliver( $config_id, $provider, (string) $destination, $week['start'], $summary ) ];
			}
		}

		$attempted = $counts['sent'] + $counts['failed'] + $counts['uncertain'];
		if ( 0 === $attempted && $counts['duplicate'] > 0 ) {
			// An overlapping run already handled every destination; its record stands.
			return null;
		}
		if ( 0 === $attempted ) {
			foreach ( $this->providers as $provider ) {
				$error = $provider->configuration_error( $settings );
				if ( '' !== $error ) {
					return $this->record( $config_id, $week, 'configuration_error', $error );
				}
			}
			return $this->record( $config_id, $week, 'configuration_error', __( 'No delivery destination is enabled and configured.', 'fair-events' ) );
		}

		if ( $counts['sent'] === $attempted ) {
			$status = 'sent';
		} elseif ( $counts['sent'] > 0 ) {
			$status = 'partial';
		} else {
			$status = 'failed';
		}

		return $this->record(
			$config_id,
			$week,
			$status,
			sprintf(
				/* translators: 1: destinations delivered, 2: destinations failed, 3: destinations with an unknown outcome */
				__( 'Delivered: %1$d. Failed: %2$d. Unknown outcome: %3$d.', 'fair-events' ),
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
	 * @param string   $config_id   Configuration ID.
	 * @param Provider $provider    Provider.
	 * @param string   $destination Destination identifier.
	 * @param string   $week_start  First day of the covered week.
	 * @param array    $summary     Summary from the builder.
	 * @return string 'sent', 'failed', 'uncertain' or 'duplicate'.
	 */
	private function deliver( $config_id, Provider $provider, $destination, $week_start, array $summary ) {
		$provider_id = $provider->id();
		$claimed     = 0;

		try {
			$parts = $provider->split( $summary );
			$count = count( $parts );
			if ( ! $this->log->claim( $config_id, $week_start, $provider_id, $destination, 1, $count ) ) {
				return 'duplicate';
			}

			foreach ( $parts as $index => $message ) {
				$part = $index + 1;
				if ( $part > 1 && ! $this->log->claim( $config_id, $week_start, $provider_id, $destination, $part, $count ) ) {
					continue;
				}
				$claimed = $part;

				$result = $provider->send( $destination, $message );
				$this->log->finish( $config_id, $week_start, $provider_id, $destination, $part, $result );
				$claimed = 0;

				if ( 'sent' !== $result['state'] ) {
					for ( $rest = $part + 1; $rest <= $count; $rest++ ) {
						$this->log->claim( $config_id, $week_start, $provider_id, $destination, $rest, $count, 'skipped', 'previous_part_not_sent' );
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
				$this->log->finish( $config_id, $week_start, $provider_id, $destination, $claimed, $result );
			} else {
				$this->log->claim( $config_id, $week_start, $provider_id, $destination, 1, 1, 'failed', 'internal_error' );
			}
			return $result['state'];
		}
	}

	/**
	 * Store the outcome of a run, one entry per covered week.
	 *
	 * @param string                            $config_id Configuration ID.
	 * @param array{start: string, end: string} $week    Week boundaries.
	 * @param string                            $status  Run status.
	 * @param string                            $message Human-readable detail.
	 * @param array                             $counts  Destination outcome counts.
	 * @return array The run record.
	 */
	private function record( $config_id, array $week, $status, $message, array $counts = array() ) {
		$run = array(
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'status'     => $status,
			'message'    => $message,
			'counts'     => $counts,
			'time'       => current_time( 'mysql', true ),
		);

		$option = Configurations::option( $config_id, 'runs' );
		$runs   = get_option( $option, array() );
		$runs   = is_array( $runs ) ? $runs : array();
		unset( $runs[ $week['start'] ] );
		$runs = array( $week['start'] => $run ) + $runs;
		update_option( $option, array_slice( $runs, 0, self::RUN_HISTORY_MAX, true ), false );

		return $run;
	}

	/**
	 * A configuration's recorded runs, newest first.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array[]
	 */
	public static function runs( $config_id ) {
		$runs = get_option( Configurations::option( $config_id, 'runs' ), array() );
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
