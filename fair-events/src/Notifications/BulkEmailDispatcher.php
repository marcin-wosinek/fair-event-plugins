<?php
/**
 * Weekly bulk email scheduling and delivery.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per weekly email of each bulk email
 * configuration and hands the email to Fair Audience.
 *
 * Two weeks are involved and kept apart. The send week is the ISO week the
 * email goes out in, e.g. '2026-W41': at most one email is sent per send
 * week, whatever its outcome, and nothing is resent automatically. The event
 * week is the ISO week whose events the email lists — the send week or the
 * one after it.
 *
 * The send week is claimed in {@see DeliveryLog} for the configuration
 * before Fair Audience is called, so overlapping cron requests send once.
 * Each configuration has its own claims, schedule, history and last sent
 * week: two configurations both send in the same week.
 */
class BulkEmailDispatcher {
	public const HOOK = 'fair_events_notification_bulk_email';
	// Where the single configuration kept its state before configurations had
	// IDs. Read only when migrating it.
	public const LEGACY_NEXT_RUN_OPTION  = 'fair_events_notification_bulk_email_next_run';
	public const LEGACY_RUNS_OPTION      = 'fair_events_notification_bulk_email_runs';
	public const LEGACY_LAST_SENT_OPTION = 'fair_events_notification_bulk_email_last_sent_week';
	public const PROVIDER                = 'bulk_email';
	public const DESTINATION             = 'subscribers';
	private const RUN_HISTORY_MAX        = 10;

	/**
	 * Delivery record.
	 *
	 * @var DeliveryLog
	 */
	private $log;

	/**
	 * Fair Audience adapter.
	 *
	 * @var BulkEmailAdapter
	 */
	private $adapter;

	/**
	 * Provider of a week's events.
	 *
	 * @var \FairEvents\Services\WeeklyEventsProvider
	 */
	private $events;

	/**
	 * Constructor.
	 *
	 * @param DeliveryLog|null                               $log     Delivery record.
	 * @param BulkEmailAdapter|null                          $adapter Fair Audience adapter.
	 * @param \FairEvents\Services\WeeklyEventsProvider|null $events  Provider of a week's events.
	 */
	public function __construct( $log = null, $adapter = null, $events = null ) {
		$this->log     = $log ? $log : new DeliveryLog();
		$this->adapter = $adapter ? $adapter : new BulkEmailAdapter();
		$this->events  = $events ? $events : new \FairEvents\Services\WeeklyEventsProvider();
	}

	/**
	 * Register the cron worker and keep each configuration's next send scheduled.
	 *
	 * Nothing stays scheduled while Fair Audience cannot send.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ), 10, 2 );

		$active = BulkEmailAdapter::ACTIVE === ( new BulkEmailAdapter() )->availability();
		foreach ( Configurations::all( Configurations::BULK_EMAIL ) as $configuration ) {
			$id = $configuration['id'];
			if ( ! $active ) {
				if ( get_option( Configurations::option( $id, 'next_run' ), null ) ) {
					self::unschedule( $id );
				}
				continue;
			}
			$settings = BulkEmailSettings::stored( $id );
			if ( $settings['enabled'] && ! self::next_run( $id ) ) {
				// Always the next future moment: a send missed while a plugin was
				// inactive or being migrated is never replayed.
				self::schedule_next( $id, $settings, self::now() );
			}
		}
	}

	/**
	 * Cron callback.
	 *
	 * @param string $send_week ISO week the email was scheduled for, fixed at scheduling time.
	 * @param string $config_id Configuration ID; absent on sends queued before configurations had IDs.
	 * @return void
	 */
	public static function handle( $send_week, $config_id = '' ) {
		$config_id = '' === (string) $config_id ? Configurations::legacy_id( Configurations::BULK_EMAIL ) : (string) $config_id;
		if ( ! Configurations::exists( $config_id, Configurations::BULK_EMAIL ) ) {
			return;
		}
		$settings = BulkEmailSettings::get( $config_id );
		$now      = self::now();

		// Schedule the following send first, so a failure below never stops
		// the weekly cycle.
		if ( $settings['enabled'] ) {
			self::schedule_next( $config_id, $settings, $now );
		}

		( new self() )->process( $config_id, (string) $send_week, $settings, $now );
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
	 * Remove every configuration's scheduled sends.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::HOOK );
		foreach ( Configurations::all( Configurations::BULK_EMAIL ) as $configuration ) {
			delete_option( Configurations::option( $configuration['id'], 'next_run' ) );
		}
	}

	/**
	 * A configuration's scheduled send, if its cron event still exists.
	 *
	 * @param string $config_id Configuration ID.
	 * @return array{timestamp: int, send_week: string}|null
	 */
	public static function next_run( $config_id ) {
		$next = get_option( Configurations::option( $config_id, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['send_week'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['send_week'], $config_id ) );

		return $timestamp
			? array(
				'timestamp' => (int) $timestamp,
				'send_week' => (string) $next['send_week'],
			)
			: null;
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
	 * @param array              $settings  Bulk email settings.
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
	 * Schedule a configuration's first send after a moment.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param array              $settings  Its settings.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @return void
	 */
	private static function schedule_next( $config_id, array $settings, \DateTimeImmutable $after ) {
		$due  = self::next_due( $settings, $after, self::last_sent_week( $config_id ) );
		$week = self::iso_week( $due );
		$args = array( $week, $config_id );

		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			wp_schedule_single_event( $due->getTimestamp(), self::HOOK, $args );
		}
		update_option(
			Configurations::option( $config_id, 'next_run' ),
			array(
				'timestamp' => $due->getTimestamp(),
				'send_week' => $week,
			),
			false
		);
	}

	/**
	 * Send one configuration's weekly email for a send week, at most once.
	 *
	 * @param string             $config_id Configuration ID.
	 * @param string             $send_week ISO week the email was scheduled for.
	 * @param array              $settings  Bulk email settings.
	 * @param \DateTimeImmutable $now       Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $config_id, $send_week, array $settings, \DateTimeImmutable $now ) {
		$claim_date = self::week_start( $send_week );
		if ( ! $claim_date || ! $settings['enabled'] ) {
			return null;
		}

		if ( self::iso_week( $now ) !== $send_week ) {
			return $this->record( $config_id, $send_week, null, 'expired', __( 'Not sent: the scheduled week had already passed when the send ran.', 'fair-events' ) );
		}

		if ( BulkEmailAdapter::ACTIVE !== $this->adapter->availability() ) {
			return $this->record( $config_id, $send_week, null, 'suspended', __( 'Not sent: Fair Audience was not available to send the email.', 'fair-events' ) );
		}

		// From here on the send week is used up, also when the week turns out
		// empty or the send fails: nothing is resent automatically.
		if ( ! $this->log->claim( $config_id, $claim_date, self::PROVIDER, self::DESTINATION, 1, 1 ) ) {
			return null;
		}
		update_option( Configurations::option( $config_id, 'last_sent_week' ), $send_week, false );

		$result = array(
			'state'   => 'uncertain',
			'code'    => 'internal_error',
			'message' => '',
		);
		$week   = null;
		try {
			$week = $this->events->for_notification( self::event_boundaries( $settings['week_scope'], $now ), $settings['source_slug'] );
			if ( is_wp_error( $week ) ) {
				$result = self::result( 'failed', 'configuration_error' );
				return $this->record( $config_id, $send_week, null, 'configuration_error', $week->get_error_message() );
			}

			$email = $this->adapter->compose( $week, $settings );
			if ( $settings['skip_empty'] && ! empty( $email['empty'] ) ) {
				$result = self::result( 'skipped', 'no_events' );
				return $this->record( $config_id, $send_week, $week, 'skipped_empty', __( 'No events that week, so nothing was sent.', 'fair-events' ) );
			}

			$counts = $this->adapter->send( $email['subject'], $email['html'] );
			$result = self::result( 'sent', '' );

			if ( 0 === $counts['failed'] ) {
				$status = 'sent';
			} else {
				$status = $counts['sent'] > 0 ? 'partial' : 'failed';
			}

			return $this->record(
				$config_id,
				$send_week,
				$week,
				$status,
				sprintf(
					/* translators: 1: emails sent, 2: emails that failed, 3: subscribers skipped */
					__( 'Sent: %1$d. Failed: %2$d. Skipped: %3$d.', 'fair-events' ),
					$counts['sent'],
					$counts['failed'],
					$counts['skipped']
				),
				$counts
			);
		} catch ( \Throwable $e ) {
			// Some emails may have gone out before the error, so the send is
			// not repeated.
			return $this->record( $config_id, $send_week, $week, 'failed', __( 'The send stopped with an error. Some emails may have been sent; it is not repeated automatically.', 'fair-events' ) );
		} finally {
			$this->log->finish( $config_id, $claim_date, self::PROVIDER, self::DESTINATION, 1, $result );
		}
	}

	/**
	 * The ISO year and week whose events an email sent at a moment lists.
	 *
	 * @param string             $week_scope 'current' or 'next'.
	 * @param \DateTimeImmutable $now        Send moment, in the site timezone.
	 * @return array{0: int, 1: int}
	 */
	public static function event_week( $week_scope, \DateTimeImmutable $now ) {
		$day = 'next' === $week_scope ? $now->modify( '+7 days' ) : $now;
		return array( (int) $day->format( 'o' ), (int) $day->format( 'W' ) );
	}

	/**
	 * Monday-to-Sunday boundaries of the week an email sent at a moment lists.
	 *
	 * @param string             $week_scope 'current' or 'next'.
	 * @param \DateTimeImmutable $now        Send moment, in the site timezone.
	 * @return array{start: string, end: string} Site-local 'Y-m-d' boundaries.
	 */
	public static function event_boundaries( $week_scope, \DateTimeImmutable $now ) {
		list( $year, $week ) = self::event_week( $week_scope, $now );

		return \FairEvents\Services\EventsWeekSummary::iso_week_boundaries( $year, $week, 1 );
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
	 * Store the outcome of a run, one entry per send week.
	 *
	 * @param string     $config_id Configuration ID.
	 * @param string     $send_week ISO week the email was scheduled for.
	 * @param array|null $week      Events week, when it was resolved.
	 * @param string     $status    Run status.
	 * @param string     $message   Human-readable detail.
	 * @param array      $counts    Recipient outcome counts.
	 * @return array The run record.
	 */
	private function record( $config_id, $send_week, $week, $status, $message, array $counts = array() ) {
		$run = array(
			'send_week'  => $send_week,
			'week_start' => $week['week']['start'] ?? '',
			'week_end'   => $week['week']['end'] ?? '',
			'status'     => $status,
			'message'    => $message,
			'counts'     => $counts,
			'time'       => current_time( 'mysql', true ),
		);

		$option = Configurations::option( $config_id, 'runs' );
		$runs   = get_option( $option, array() );
		$runs   = is_array( $runs ) ? $runs : array();
		unset( $runs[ $send_week ] );
		$runs = array( $send_week => $run ) + $runs;
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
	 * Build a delivery result.
	 *
	 * @param string $state Delivery state.
	 * @param string $code  Safe code.
	 * @return array{state: string, code: string, message: string}
	 */
	private static function result( $state, $code ) {
		return array(
			'state'   => $state,
			'code'    => $code,
			'message' => '',
		);
	}
}
