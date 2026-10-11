<?php
/**
 * Weekly bulk email scheduling and delivery.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per weekly email and hands the email to Fair
 * Audience.
 *
 * Two weeks are involved and kept apart. The send week is the ISO week the
 * email goes out in, e.g. '2026-W41': at most one email is sent per send
 * week, whatever its outcome, and nothing is resent automatically. The event
 * week is the ISO week whose events the email lists — the send week or the
 * one after it.
 *
 * The send week is claimed in {@see DeliveryLog} before Fair Audience is
 * called, so overlapping cron requests send once.
 */
class BulkEmailDispatcher {
	public const HOOK             = 'fair_events_notification_bulk_email';
	public const NEXT_RUN_OPTION  = 'fair_events_notification_bulk_email_next_run';
	public const RUNS_OPTION      = 'fair_events_notification_bulk_email_runs';
	public const LAST_SENT_OPTION = 'fair_events_notification_bulk_email_last_sent_week';
	public const PROVIDER         = 'bulk_email';
	public const DESTINATION      = 'subscribers';
	private const RUN_HISTORY_MAX = 10;

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
	 * Register the cron worker and keep the next send scheduled.
	 *
	 * Nothing stays scheduled while Fair Audience cannot send.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ) );

		if ( BulkEmailAdapter::ACTIVE !== ( new BulkEmailAdapter() )->availability() ) {
			if ( get_option( self::NEXT_RUN_OPTION, null ) ) {
				self::unschedule();
			}
			return;
		}

		$settings = BulkEmailSettings::stored();
		if ( $settings['enabled'] && ! self::next_run() ) {
			// Always the next future moment: a send missed while a plugin was
			// inactive or being migrated is never replayed.
			self::schedule_next( $settings, self::now() );
		}
	}

	/**
	 * Cron callback.
	 *
	 * @param string $send_week ISO week the email was scheduled for, fixed at scheduling time.
	 * @return void
	 */
	public static function handle( $send_week ) {
		$settings = BulkEmailSettings::get();
		$now      = self::now();

		// Schedule the following send first, so a failure below never stops
		// the weekly cycle.
		if ( $settings['enabled'] ) {
			self::schedule_next( $settings, $now );
		}

		( new self() )->process( (string) $send_week, $settings, $now );
	}

	/**
	 * Replace the scheduled send after settings change.
	 *
	 * @param array $settings Bulk email settings.
	 * @return void
	 */
	public static function reschedule( array $settings ) {
		$next = self::next_run();
		if ( $settings['enabled'] && $next && $next['timestamp'] <= time() ) {
			// A due send is waiting for WP-Cron. Keep it: when it runs, it schedules the
			// following send from the new settings.
			return;
		}

		self::unschedule();
		if ( $settings['enabled'] ) {
			self::schedule_next( $settings, self::now() );
		}
	}

	/**
	 * Remove the scheduled send.
	 *
	 * @return void
	 */
	public static function unschedule() {
		wp_unschedule_hook( self::HOOK );
		delete_option( self::NEXT_RUN_OPTION );
	}

	/**
	 * The scheduled send, if its cron event still exists.
	 *
	 * @return array{timestamp: int, send_week: string}|null
	 */
	public static function next_run() {
		$next = get_option( self::NEXT_RUN_OPTION, null );
		if ( ! is_array( $next ) || empty( $next['send_week'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['send_week'] ) );

		return $timestamp
			? array(
				'timestamp' => (int) $timestamp,
				'send_week' => (string) $next['send_week'],
			)
			: null;
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
	 * Schedule the first send after a moment.
	 *
	 * @param array              $settings Bulk email settings.
	 * @param \DateTimeImmutable $after    Reference moment, in the site timezone.
	 * @return void
	 */
	private static function schedule_next( array $settings, \DateTimeImmutable $after ) {
		$due  = self::next_due( $settings, $after, (string) get_option( self::LAST_SENT_OPTION, '' ) );
		$week = self::iso_week( $due );
		$args = array( $week );

		if ( ! wp_next_scheduled( self::HOOK, $args ) ) {
			wp_schedule_single_event( $due->getTimestamp(), self::HOOK, $args );
		}
		update_option(
			self::NEXT_RUN_OPTION,
			array(
				'timestamp' => $due->getTimestamp(),
				'send_week' => $week,
			),
			false
		);
	}

	/**
	 * Send the weekly email for a send week, at most once.
	 *
	 * @param string             $send_week ISO week the email was scheduled for.
	 * @param array              $settings  Bulk email settings.
	 * @param \DateTimeImmutable $now       Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $send_week, array $settings, \DateTimeImmutable $now ) {
		$claim_date = self::week_start( $send_week );
		if ( ! $claim_date || ! $settings['enabled'] ) {
			return null;
		}

		if ( self::iso_week( $now ) !== $send_week ) {
			return $this->record( $send_week, null, 'expired', __( 'Not sent: the scheduled week had already passed when the send ran.', 'fair-events' ) );
		}

		if ( BulkEmailAdapter::ACTIVE !== $this->adapter->availability() ) {
			return $this->record( $send_week, null, 'suspended', __( 'Not sent: Fair Audience was not available to send the email.', 'fair-events' ) );
		}

		// From here on the send week is used up, also when the week turns out
		// empty or the send fails: nothing is resent automatically.
		if ( ! $this->log->claim( $claim_date, self::PROVIDER, self::DESTINATION, 1, 1 ) ) {
			return null;
		}
		update_option( self::LAST_SENT_OPTION, $send_week, false );

		$result = array(
			'state'   => 'uncertain',
			'code'    => 'internal_error',
			'message' => '',
		);
		$week   = null;
		try {
			$week = $this->events->get_week( $settings['source_slug'], ...self::event_week( $settings['week_scope'], $now ) );
			if ( is_wp_error( $week ) ) {
				$result = self::result( 'failed', 'configuration_error' );
				return $this->record( $send_week, null, 'configuration_error', $week->get_error_message() );
			}

			$email = $this->adapter->compose( $week, $settings );
			if ( $settings['skip_empty'] && ! empty( $email['empty'] ) ) {
				$result = self::result( 'skipped', 'no_events' );
				return $this->record( $send_week, $week, 'skipped_empty', __( 'No events that week, so nothing was sent.', 'fair-events' ) );
			}

			$counts = $this->adapter->send( $email['subject'], $email['html'] );
			$result = self::result( 'sent', '' );

			if ( 0 === $counts['failed'] ) {
				$status = 'sent';
			} else {
				$status = $counts['sent'] > 0 ? 'partial' : 'failed';
			}

			return $this->record(
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
			return $this->record( $send_week, $week, 'failed', __( 'The send stopped with an error. Some emails may have been sent; it is not repeated automatically.', 'fair-events' ) );
		} finally {
			$this->log->finish( $claim_date, self::PROVIDER, self::DESTINATION, 1, $result );
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
	 * @param string     $send_week ISO week the email was scheduled for.
	 * @param array|null $week      Events week, when it was resolved.
	 * @param string     $status    Run status.
	 * @param string     $message   Human-readable detail.
	 * @param array      $counts    Recipient outcome counts.
	 * @return array The run record.
	 */
	private function record( $send_week, $week, $status, $message, array $counts = array() ) {
		$run = array(
			'send_week'  => $send_week,
			'week_start' => $week['week']['start'] ?? '',
			'week_end'   => $week['week']['end'] ?? '',
			'status'     => $status,
			'message'    => $message,
			'counts'     => $counts,
			'time'       => current_time( 'mysql', true ),
		);

		$runs = get_option( self::RUNS_OPTION, array() );
		$runs = is_array( $runs ) ? $runs : array();
		unset( $runs[ $send_week ] );
		$runs = array( $send_week => $run ) + $runs;
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
