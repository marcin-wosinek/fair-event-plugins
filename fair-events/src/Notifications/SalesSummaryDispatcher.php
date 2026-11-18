<?php
/**
 * Sales summary scheduling and delivery.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Core\Cron;
use FairEvents\Services\EmailService;
use FairEvents\Services\SalesSummaryStatistics;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per sales summary send and delivers it to
 * each recipient separately (#2306).
 *
 * A send is identified by its report, cadence and occurrence
 * ({@see SalesSummaryPeriod}). Each recipient is claimed in
 * {@see DeliveryLog} before anything is sent to it, under the report as
 * configuration, the period start as week, the cadence as provider and a
 * hash of the lower-cased address as destination. Overlapping cron runs
 * therefore send to each address once, daily and weekly sends never share a
 * claim, and none of them collides with the weekly event notifications. A
 * failed or uncertain send is never retried, and a send whose occurrence
 * has passed is never replayed.
 *
 * Every recipient gets its own email, so nobody sees another private
 * address, and a failure for one recipient never stops the others.
 */
class SalesSummaryDispatcher {
	public const HOOK            = 'fair_events_sales_summary';
	public const CHANNEL         = 'sales_summary';
	public const PROVIDER_PREFIX = 'sales_';
	private const STATE_PREFIX   = 'fair_events_sales_summary_';
	private const RUN_HISTORY    = 10;

	/**
	 * Delivery record.
	 *
	 * @var DeliveryLog
	 */
	private $log;

	/**
	 * Mail transport.
	 *
	 * @var EmailService
	 */
	private $mailer;

	/**
	 * Sales figures.
	 *
	 * @var SalesSummaryStatistics
	 */
	private $statistics;

	/**
	 * Organizer directory.
	 *
	 * @var SalesSummaryOrganizers
	 */
	private $organizers;

	/**
	 * Execution history.
	 *
	 * @var ExecutionHistory
	 */
	private $history;

	/**
	 * Constructor.
	 *
	 * @param DeliveryLog|null            $log        Delivery record.
	 * @param EmailService|null           $mailer     Mail transport.
	 * @param SalesSummaryStatistics|null $statistics Sales figures.
	 * @param SalesSummaryOrganizers|null $organizers Organizer directory.
	 * @param ExecutionHistory|null       $history    Execution history.
	 */
	public function __construct( $log = null, $mailer = null, $statistics = null, $organizers = null, $history = null ) {
		$this->log        = $log ? $log : new DeliveryLog();
		$this->mailer     = $mailer ? $mailer : new EmailService();
		$this->statistics = $statistics ? $statistics : new SalesSummaryStatistics();
		$this->organizers = $organizers ? $organizers : new SalesSummaryOrganizers();
		$this->history    = $history ? $history : new ExecutionHistory();
	}

	/**
	 * Register the cron worker and keep each enabled report's next send
	 * scheduled. A report whose organizer can't be resolved now is not
	 * scheduled; it resumes once organizer resolution is back.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ), 10, 3 );

		$organizers = new SalesSummaryOrganizers();
		foreach ( SalesSummarySettings::all() as $key => $settings ) {
			if ( SalesSummarySettings::is_enabled( $settings ) && $organizers->report_available( $key ) && ! self::next_run( $key ) ) {
				// Always the next future moment: a send missed meanwhile is never replayed.
				self::schedule_next( $key, $settings, BulkEmailDispatcher::now() );
			}
		}
	}

	/**
	 * Cron callback.
	 *
	 * @param string $occurrence Occurrence the send was scheduled for.
	 * @param string $key        Report key.
	 * @param string $frequency  Cadence it was scheduled with.
	 * @return void
	 */
	public static function handle( $occurrence, $key = '', $frequency = '' ) {
		$key = (string) $key;
		if ( ! SalesSummarySettings::valid_key( $key ) ) {
			return;
		}
		$settings = SalesSummarySettings::get( $key );
		$now      = BulkEmailDispatcher::now();

		// Schedule the following send first, so a failure below never stops the cycle.
		if ( SalesSummarySettings::is_enabled( $settings ) ) {
			self::schedule_next( $key, $settings, $now );
		} else {
			self::unschedule( $key );
		}

		( new self() )->process( $key, (string) $frequency, (string) $occurrence, $settings, $now );
	}

	/**
	 * Replace a report's scheduled send after its settings change.
	 *
	 * @param string $key      Report key.
	 * @param array  $settings Its settings.
	 * @return void
	 */
	public static function reschedule( $key, array $settings ) {
		self::unschedule( $key );
		if ( SalesSummarySettings::is_enabled( $settings ) && ( new SalesSummaryOrganizers() )->report_available( $key ) ) {
			self::schedule_next( $key, $settings, BulkEmailDispatcher::now() );
		}
	}

	/**
	 * Remove a report's scheduled sends.
	 *
	 * @param string $key Report key.
	 * @return void
	 */
	public static function unschedule( $key ) {
		foreach ( ScheduledSends::events( self::HOOK ) as list( $timestamp, $args ) ) {
			if ( isset( $args[1] ) && $args[1] === $key ) {
				wp_unschedule_event( $timestamp, self::HOOK, $args );
			}
		}
		delete_option( self::option( $key, 'next_run' ) );
	}

	/**
	 * Remove every scheduled send.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::HOOK );
		foreach ( array_keys( SalesSummarySettings::all() ) as $key ) {
			delete_option( self::option( $key, 'next_run' ) );
		}
	}

	/**
	 * A report's scheduled send, if its cron event still exists.
	 *
	 * @param string $key Report key.
	 * @return array{timestamp: int, occurrence: string, frequency: string}|null
	 */
	public static function next_run( $key ) {
		$next = get_option( self::option( $key, 'next_run' ), null );
		if ( ! is_array( $next ) || empty( $next['occurrence'] ) || empty( $next['frequency'] ) ) {
			return null;
		}
		$timestamp = wp_next_scheduled( self::HOOK, array( $next['occurrence'], $key, $next['frequency'] ) );

		return $timestamp
			? array(
				'timestamp'  => (int) $timestamp,
				'occurrence' => (string) $next['occurrence'],
				'frequency'  => (string) $next['frequency'],
			)
			: null;
	}

	/**
	 * Schedule a report's first send after a moment, skipping the
	 * occurrence already sent.
	 *
	 * @param string             $key      Report key.
	 * @param array              $settings Its settings.
	 * @param \DateTimeImmutable $after    Reference moment, in the site timezone.
	 * @return bool Whether the send is scheduled.
	 */
	private static function schedule_next( $key, array $settings, \DateTimeImmutable $after ) {
		$due        = SalesSummaryPeriod::next_due( $settings, $after );
		$occurrence = SalesSummaryPeriod::occurrence( $settings['frequency'], $due );
		if ( (string) get_option( self::option( $key, 'last_sent' ), '' ) === $settings['frequency'] . '|' . $occurrence ) {
			$due        = SalesSummaryPeriod::next_due( $settings, $due );
			$occurrence = SalesSummaryPeriod::occurrence( $settings['frequency'], $due );
		}
		$args = array( $occurrence, $key, $settings['frequency'] );

		if ( true !== Cron::ensure_single( $due->getTimestamp(), self::HOOK, $args ) ) {
			delete_option( self::option( $key, 'next_run' ) );
			return false;
		}
		update_option(
			self::option( $key, 'next_run' ),
			array(
				'timestamp'  => $due->getTimestamp(),
				'occurrence' => $occurrence,
				'frequency'  => $settings['frequency'],
			),
			false
		);
		return true;
	}

	/**
	 * Build a report for a period, as scheduled sends and previews do.
	 *
	 * @param string $key       Report key.
	 * @param string $frequency Daily or weekly.
	 * @param array  $period    Period boundaries.
	 * @return array|null Null when the report's organizer can't be resolved.
	 */
	public function report( $key, $frequency, array $period ) {
		if ( ! $this->organizers->report_available( $key ) ) {
			return null;
		}
		list( $from, $to ) = SalesSummaryPeriod::bounds( $period );
		return ( new SalesSummaryReport( $this->organizers ) )->build( $key, $frequency, $period, $this->statistics->for_period( $from, $to ) );
	}

	/**
	 * Deliver one report's send, at most once per recipient.
	 *
	 * @param string             $key        Report key.
	 * @param string             $frequency  Cadence the send was scheduled with.
	 * @param string             $occurrence Occurrence it was scheduled for.
	 * @param array              $settings   Report settings now.
	 * @param \DateTimeImmutable $now        Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $key, $frequency, $occurrence, array $settings, \DateTimeImmutable $now ) {
		$period = SalesSummaryPeriod::period( $frequency, $occurrence );
		// A send queued before the report was turned off or changed cadence does nothing.
		if ( null === $period || ! SalesSummarySettings::is_enabled( $settings ) || $settings['frequency'] !== $frequency ) {
			return null;
		}

		$recorder = new HistoryRecorder(
			$this->history,
			array(
				'config_id'   => $key,
				'config_name' => $this->report_name( $key ),
				'channel'     => self::CHANNEL,
				'origin'      => HistoryOutcome::SCHEDULED,
				'occurrence'  => $occurrence,
				'week_start'  => $period['start'],
				'week_end'    => $period['end'],
			)
		);

		if ( SalesSummaryPeriod::occurrence( $frequency, $now ) !== $occurrence ) {
			$recorder->finish( HistoryOutcome::SKIPPED, 'expired' );
			return $this->record( $key, $frequency, $occurrence, $period, 'expired', array(), false );
		}

		try {
			$report = $this->report( $key, $frequency, $period );
		} catch ( \Throwable $e ) {
			$recorder->finish( HistoryOutcome::FAILURE, 'internal_error' );
			return $this->record( $key, $frequency, $occurrence, $period, 'failed', array(), false );
		}
		if ( null === $report ) {
			$recorder->finish( HistoryOutcome::SKIPPED, 'organizers_unavailable' );
			return $this->record( $key, $frequency, $occurrence, $period, 'paused', array(), false );
		}

		$target = SalesSummaryReport::recipients( $report, $settings );
		if ( ! $target['recipients'] ) {
			$recorder->finish( HistoryOutcome::FAILURE, 'configuration_error' );
			return $this->record( $key, $frequency, $occurrence, $period, 'configuration_error', array(), true );
		}

		update_option( self::option( $key, 'last_sent' ), $frequency . '|' . $occurrence, false );
		$email    = SalesSummaryRenderer::compose( $report );
		$provider = self::PROVIDER_PREFIX . $frequency;
		$outcomes = array();
		foreach ( $target['recipients'] as $recipient ) {
			$destination = self::destination( $recipient );
			if ( ! $this->log->claim( $key, $period['start'], $provider, $destination, 1, 1 ) ) {
				// Another run is sending, or already sent, to this address.
				continue;
			}
			$recorder->claimed();

			$result   = array(
				'state'   => 'uncertain',
				'code'    => 'internal_error',
				'message' => '',
			);
			$delivery = $recorder->attempt( $recipient, 0, 0, $target['fallback'] ? __( 'Fallback address', 'fair-events' ) : '' );
			try {
				if ( $this->mailer->send_notification( $recipient, $email['subject'], $email['html'] ) ) {
					$result = array(
						'state'   => 'sent',
						'code'    => '',
						'message' => '',
					);
					$recorder->settle( $delivery, HistoryOutcome::ACCEPTED );
				} else {
					$result = array(
						'state'   => 'failed',
						'code'    => 'send_failed',
						'message' => '',
					);
					$recorder->settle( $delivery, HistoryOutcome::FAILED, 'send_failed' );
				}
			} catch ( \Throwable $e ) {
				// The email may have gone out before the error: not retried.
				$recorder->settle( $delivery, HistoryOutcome::UNKNOWN, 'internal_error' );
			} finally {
				$this->log->finish( $key, $period['start'], $provider, $destination, 1, $result );
			}
			$outcomes[ $recipient ] = $result['state'];
		}

		if ( ! $outcomes ) {
			$recorder->lost_claim();
			$recorder->finish();
			return null;
		}
		$recorder->finish();

		$states = array_unique( array_values( $outcomes ) );
		$status = array( 'sent' ) === $states ? 'sent' : ( in_array( 'sent', $states, true ) ? 'partial' : 'failed' );
		return $this->record( $key, $frequency, $occurrence, $period, $status, $outcomes, $target['fallback'] );
	}

	/**
	 * The delivery claim destination of an address: never the address itself.
	 *
	 * @param string $recipient Address.
	 * @return string
	 */
	public static function destination( $recipient ) {
		return 'email:' . md5( strtolower( (string) $recipient ) );
	}

	/**
	 * A report's name in history.
	 *
	 * @param string $key Report key.
	 * @return string
	 */
	private function report_name( $key ) {
		if ( SalesSummarySettings::CENTRAL === $key ) {
			return __( 'Sales summary: all organizers', 'fair-events' );
		}
		$organizer = $this->organizers->find( $key );
		/* translators: %s: organizer name */
		return sprintf( __( 'Sales summary: %s', 'fair-events' ), $organizer ? $organizer['name'] : $key );
	}

	/**
	 * Store the outcome of a run, newest first.
	 *
	 * @param string $key        Report key.
	 * @param string $frequency  Cadence.
	 * @param string $occurrence Occurrence.
	 * @param array  $period     Period.
	 * @param string $status     sent, partial, failed, expired, paused or configuration_error.
	 * @param array  $outcomes   Delivery state by recipient.
	 * @param bool   $fallback   Whether the fallback address was used.
	 * @return array The run record.
	 */
	private function record( $key, $frequency, $occurrence, array $period, $status, array $outcomes, $fallback ) {
		$counts = array_count_values( array_values( $outcomes ) );
		$run    = array(
			'frequency'    => $frequency,
			'occurrence'   => $occurrence,
			'period_start' => $period['start'],
			'period_end'   => $period['end'],
			'status'       => $status,
			'fallback'     => (bool) $fallback,
			'recipients'   => count( $outcomes ),
			'sent'         => $counts['sent'] ?? 0,
			'failed'       => $counts['failed'] ?? 0,
			'uncertain'    => $counts['uncertain'] ?? 0,
			'time'         => current_time( 'mysql', true ),
		);

		$option = self::option( $key, 'runs' );
		$runs   = get_option( $option, array() );
		$runs   = is_array( $runs ) ? $runs : array();
		$id     = $frequency . '|' . $occurrence;
		unset( $runs[ $id ] );
		$runs = array( $id => $run ) + $runs;
		update_option( $option, array_slice( $runs, 0, self::RUN_HISTORY, true ), false );

		return $run;
	}

	/**
	 * A report's recorded runs, newest first.
	 *
	 * @param string $key Report key.
	 * @return array[]
	 */
	public static function runs( $key ) {
		$runs = get_option( self::option( $key, 'runs' ), array() );
		return is_array( $runs ) ? array_values( $runs ) : array();
	}

	/**
	 * Option holding one piece of a report's delivery state.
	 *
	 * @param string $key   Report key.
	 * @param string $field next_run, last_sent or runs.
	 * @return string
	 */
	public static function option( $key, $field ) {
		return self::STATE_PREFIX . $field . '_' . $key;
	}
}
