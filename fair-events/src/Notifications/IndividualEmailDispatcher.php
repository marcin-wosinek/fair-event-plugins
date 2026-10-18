<?php
/**
 * Individual email scheduling and delivery.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\EmailService;

defined( 'WPINC' ) || die;

/**
 * Schedules one WP-Cron event per weekly email of each individual email
 * configuration and sends it to that configuration's address.
 *
 * As for the bulk email, two weeks are kept apart: the send week the email
 * goes out in, e.g. '2026-W41', and the event week whose events it lists.
 *
 * The send week is claimed in {@see DeliveryLog} for the configuration
 * before anything is sent, under a destination that does not depend on the
 * address. Overlapping cron
 * requests therefore send once, and changing the address or the schedule
 * after an attempt cannot cause a second scheduled send that week. A failed
 * or uncertain send is never retried automatically. Two configurations with
 * the same address claim separately, so both send.
 */
class IndividualEmailDispatcher {
	public const HOOK = 'fair_events_notification_individual_email';
	// Where the single configuration kept its state before configurations had
	// IDs. Read only when migrating it.
	public const LEGACY_NEXT_RUN_OPTION  = 'fair_events_notification_individual_email_next_run';
	public const LEGACY_RUNS_OPTION      = 'fair_events_notification_individual_email_runs';
	public const LEGACY_LAST_SENT_OPTION = 'fair_events_notification_individual_email_last_sent_week';
	public const PROVIDER                = 'individual_email';
	public const DESTINATION             = 'recipient';
	private const RUN_HISTORY_MAX        = 10;

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
	 * Provider of a week's events.
	 *
	 * @var IndividualEmailEvents
	 */
	private $events;

	/**
	 * Constructor.
	 *
	 * @param DeliveryLog|null           $log    Delivery record.
	 * @param EmailService|null          $mailer Mail transport.
	 * @param IndividualEmailEvents|null $events Provider of a week's events.
	 */
	public function __construct( $log = null, $mailer = null, $events = null ) {
		$this->log    = $log ? $log : new DeliveryLog();
		$this->mailer = $mailer ? $mailer : new EmailService();
		$this->events = $events ? $events : new IndividualEmailEvents();
	}

	/**
	 * Register the cron worker and keep each configuration's next send scheduled.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( self::HOOK, array( self::class, 'handle' ), 10, 2 );

		foreach ( Configurations::all( Configurations::INDIVIDUAL_EMAIL ) as $configuration ) {
			$settings = IndividualEmailSettings::stored( $configuration['id'] );
			if ( $settings['enabled'] && ! self::next_run( $configuration['id'] ) ) {
				// Always the next future moment: a send missed while the plugin
				// was inactive is never replayed.
				self::schedule_next( $configuration['id'], $settings, BulkEmailDispatcher::now() );
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
		$config_id = '' === (string) $config_id ? Configurations::legacy_id( Configurations::INDIVIDUAL_EMAIL ) : (string) $config_id;
		if ( ! Configurations::exists( $config_id, Configurations::INDIVIDUAL_EMAIL ) ) {
			return;
		}
		$settings = IndividualEmailSettings::get( $config_id );
		$now      = BulkEmailDispatcher::now();

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
			self::schedule_next( $config_id, $settings, BulkEmailDispatcher::now() );
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
		foreach ( Configurations::all( Configurations::INDIVIDUAL_EMAIL ) as $configuration ) {
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
	 * The first send moment after a moment whose send week is still open.
	 *
	 * @param array              $settings  Individual email settings.
	 * @param \DateTimeImmutable $after     Reference moment, in the site timezone.
	 * @param string             $last_sent Send week already used, or ''.
	 * @return \DateTimeImmutable
	 */
	public static function next_due( array $settings, \DateTimeImmutable $after, $last_sent ) {
		return BulkEmailDispatcher::next_due( $settings, $after, $last_sent );
	}

	/**
	 * Monday-to-Sunday boundaries of the week an email sent at a moment lists.
	 *
	 * @param string             $week_scope 'current' or 'next'.
	 * @param \DateTimeImmutable $now        Send moment, in the site timezone.
	 * @return array{start: string, end: string} Site-local 'Y-m-d' boundaries.
	 */
	public static function event_week( $week_scope, \DateTimeImmutable $now ) {
		return BulkEmailDispatcher::event_boundaries( $week_scope, $now );
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
		$due  = self::next_due( $settings, $after, BulkEmailDispatcher::last_sent_week( $config_id ) );
		$week = BulkEmailDispatcher::iso_week( $due );
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
	 * @param array              $settings  Individual email settings.
	 * @param \DateTimeImmutable $now       Current moment, in the site timezone.
	 * @return array|null The run record, or null when nothing ran.
	 */
	public function process( $config_id, $send_week, array $settings, \DateTimeImmutable $now ) {
		$claim_date = BulkEmailDispatcher::week_start( $send_week );
		if ( ! $claim_date || ! $settings['enabled'] ) {
			return null;
		}

		$recipient = (string) IndividualEmailSettings::parse_recipient( $settings['recipient'] );

		if ( BulkEmailDispatcher::iso_week( $now ) !== $send_week ) {
			return $this->record( $config_id, $send_week, null, $recipient, 'expired', __( 'Not sent: the scheduled week had already passed when the send ran.', 'fair-events' ) );
		}

		// From here on the send week is used up, also when the week turns out
		// empty or the send fails: nothing is resent automatically.
		if ( ! $this->log->claim( $config_id, $claim_date, self::PROVIDER, self::DESTINATION, 1, 1 ) ) {
			return null;
		}
		update_option( Configurations::option( $config_id, 'last_sent_week' ), $send_week, false );

		$result = self::result( 'uncertain', 'internal_error' );
		$week   = null;
		try {
			if ( '' === $recipient ) {
				$result = self::result( 'failed', 'configuration_error' );
				return $this->record( $config_id, $send_week, null, $recipient, 'configuration_error', __( 'Not sent: no valid email address is saved.', 'fair-events' ) );
			}

			$week        = self::event_week( $settings['week_scope'], $now );
			$occurrences = $this->events->for_week( $settings['event_selection'], $week );
			if ( is_wp_error( $occurrences ) ) {
				$result = self::result( 'failed', 'configuration_error' );
				return $this->record( $config_id, $send_week, $week, $recipient, 'configuration_error', $occurrences->get_error_message() );
			}

			$email = IndividualEmailRenderer::compose( $settings, $week, $occurrences );
			if ( $settings['skip_empty'] && $email['empty'] ) {
				$result = self::result( 'skipped', 'no_events' );
				return $this->record( $config_id, $send_week, $week, $recipient, 'skipped_empty', __( 'No events that week, so nothing was sent.', 'fair-events' ) );
			}

			if ( ! $this->mailer->send_notification( $recipient, $email['subject'], $email['html'] ) ) {
				$result = self::result( 'failed', 'send_failed' );
				return $this->record( $config_id, $send_week, $week, $recipient, 'failed', __( 'The site could not hand the email over for delivery. It is not repeated automatically.', 'fair-events' ) );
			}

			$result = self::result( 'sent', '' );
			return $this->record( $config_id, $send_week, $week, $recipient, 'sent', __( 'Handed over to the site’s mail system. This does not confirm that it reached the inbox.', 'fair-events' ) );
		} catch ( \Throwable $e ) {
			// The email may have gone out before the error, so the send is
			// not repeated.
			return $this->record( $config_id, $send_week, $week, $recipient, 'failed', __( 'The send stopped with an error. The email may have been sent; it is not repeated automatically.', 'fair-events' ) );
		} finally {
			$this->log->finish( $config_id, $claim_date, self::PROVIDER, self::DESTINATION, 1, $result );
		}
	}

	/**
	 * Store the outcome of a run, one entry per send week.
	 *
	 * @param string     $config_id   Configuration ID.
	 * @param string     $send_week   ISO week the email was scheduled for.
	 * @param array|null $week        Event week boundaries, when they were resolved.
	 * @param string     $destination Address the run was for.
	 * @param string     $status      Run status.
	 * @param string     $message     Human-readable detail.
	 * @return array The run record.
	 */
	private function record( $config_id, $send_week, $week, $destination, $status, $message ) {
		$run = array(
			'send_week'   => $send_week,
			'week_start'  => $week['start'] ?? '',
			'week_end'    => $week['end'] ?? '',
			'destination' => $destination,
			'status'      => $status,
			'message'     => $message,
			'time'        => current_time( 'mysql', true ),
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
