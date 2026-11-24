<?php
/**
 * Telegram ticket sale alerts.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Core\Cron;
use FairEvents\Services\PaymentAttribution;

defined( 'WPINC' ) || die;

/**
 * Sends one Telegram message to the event's organizer for each paid Get
 * Tickets checkout (#2448).
 *
 * A confirmation (`fair_events_signup_confirmed`) only queues the
 * transaction's alert and schedules a worker, so checkout never waits for
 * Telegram. The worker claims the alert atomically, waits until every
 * purchase the payment is linked to is confirmed (a series purchase is
 * confirmed one occurrence at a time), and checks again, at send time, that
 * the event still belongs to the organizer the alert was queued for and
 * that the organizer's switch is on with a destination. Nothing is queued
 * while every organizer's switch is off.
 *
 * Routing: an event with no stored assignment belongs to the sitewide
 * organizer. An event assigned to an additional organizer is sent only to
 * that organizer's destination; while that organizer can't be resolved
 * (organizer management off, organizer removed), the alert is skipped and
 * never forwarded to the sitewide destination.
 *
 * Every outcome is recorded ({@see SaleAlertLog}) for the Event
 * notifications page. An alert Telegram may have accepted is recorded as
 * uncertain and never resent automatically.
 *
 * Frequency (#2449): an organizer set to a daily or weekly digest has its
 * checked sales kept as pending instead of sent. One WP-Cron event per
 * organizer sends them at the configured site-local time
 * ({@see SalesSummaryPeriod::next_due()}), as one message, and only when
 * there are any. Each sale is checked again when its digest is built. A
 * digest Telegram refused keeps its sales pending for the next one; one
 * Telegram may have accepted is uncertain and never resent. Switching an
 * organizer back to Immediate sends what is pending as one final digest.
 */
class SaleAlertDispatcher {
	public const WORKER_HOOK   = 'fair_events_sale_alert_send';
	public const RECOVERY_HOOK = 'fair_events_sale_alert_recovery';
	public const DIGEST_HOOK   = 'fair_events_sale_alert_digest';

	/**
	 * Occurrence of a digest that sends what is pending right away.
	 */
	public const FLUSH = 'now';

	/**
	 * Seconds to wait for every linked purchase to be confirmed.
	 */
	public const CONFIRMATION_WAIT = HOUR_IN_SECONDS;

	/**
	 * Seconds before a worker that stopped mid-alert is considered gone.
	 */
	public const STALE_AFTER = 10 * MINUTE_IN_SECONDS;

	/**
	 * Seconds between checks while purchases await confirmation.
	 */
	public const RECHECK_AFTER = MINUTE_IN_SECONDS;

	// Skip reasons. Warnings name a configuration an administrator can fix.
	// Disabled: recorded while the former sitewide switch was off.
	public const REASON_DISABLED              = 'disabled';
	public const REASON_ORGANIZER_DISABLED    = 'organizer_disabled';
	public const REASON_MISSING_DESTINATION   = 'missing_destination';
	public const REASON_ORGANIZER_UNAVAILABLE = 'organizer_unavailable';
	public const REASON_ASSIGNMENT_CHANGED    = 'assignment_changed';
	public const REASON_NOT_PAID              = 'not_paid';
	public const REASON_MISSING_TRANSACTION   = 'missing_transaction';
	public const REASON_UNATTRIBUTED          = 'unattributed';
	public const REASON_INCOMPLETE            = 'incomplete';
	public const REASON_INCONSISTENT          = 'inconsistent';
	public const REASON_INTERRUPTED           = 'interrupted';

	/**
	 * Alert records.
	 *
	 * @var SaleAlertLog
	 */
	private $log;

	/**
	 * Sale reader.
	 *
	 * @var SaleAlertSource
	 */
	private $source;

	/**
	 * Organizer directory.
	 *
	 * @var SalesSummaryOrganizers
	 */
	private $organizers;

	/**
	 * Telegram transport.
	 *
	 * @var TelegramProvider
	 */
	private $provider;

	/**
	 * Constructor.
	 *
	 * @param SaleAlertLog|null           $log        Alert records.
	 * @param SaleAlertSource|null        $source     Sale reader.
	 * @param SalesSummaryOrganizers|null $organizers Organizer directory.
	 * @param TelegramProvider|null       $provider   Telegram transport.
	 */
	public function __construct( $log = null, $source = null, $organizers = null, $provider = null ) {
		$this->log        = $log ? $log : new SaleAlertLog();
		$this->source     = $source ? $source : new SaleAlertSource();
		$this->organizers = $organizers ? $organizers : new SalesSummaryOrganizers();
		$this->provider   = $provider ? $provider : new TelegramProvider();
	}

	/**
	 * Install the records table and hook the alerts.
	 *
	 * @return void
	 */
	public static function init() {
		SaleAlertLog::maybe_install();

		add_action( 'fair_events_signup_confirmed', array( self::class, 'handle_signup_confirmed' ), 20, 2 );
		add_action( self::WORKER_HOOK, array( self::class, 'handle_worker' ) );
		add_action( self::RECOVERY_HOOK, array( self::class, 'handle_recovery' ) );
		add_action( self::DIGEST_HOOK, array( self::class, 'handle_digest' ), 10, 3 );

		SaleAlertSettings::migrate();
		if ( SaleAlertSettings::any_enabled() ) {
			Cron::ensure_recurring( self::RECOVERY_HOOK, 'hourly', time() + HOUR_IN_SECONDS );
		}
	}

	/**
	 * Stop scheduled work. Settings and records stay.
	 *
	 * @return void
	 */
	public static function unschedule_all() {
		wp_unschedule_hook( self::WORKER_HOOK );
		wp_unschedule_hook( self::RECOVERY_HOOK );
		wp_unschedule_hook( self::DIGEST_HOOK );
	}

	/**
	 * Hook callback for a confirmed purchase.
	 *
	 * @param object $signup      Confirmed signup row.
	 * @param object $transaction Connector transaction.
	 * @return void
	 */
	public static function handle_signup_confirmed( $signup, $transaction ) {
		try {
			( new self() )->queue( $signup, $transaction );
		} catch ( \Throwable $e ) {
			// Checkout confirmation never depends on the alert.
			unset( $e );
		}
	}

	/**
	 * Worker callback.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return void
	 */
	public static function handle_worker( $transaction_id ) {
		( new self() )->process( (int) $transaction_id );
	}

	/**
	 * Recovery callback.
	 *
	 * @return void
	 */
	public static function handle_recovery() {
		( new self() )->recover();
	}

	/**
	 * Digest callback. The organizer's next digest is scheduled first, so
	 * a failure below never stops the cycle. A send queued with a cadence
	 * the organizer no longer has does nothing.
	 *
	 * @param string $organizer  Organizer key.
	 * @param string $frequency  Cadence it was scheduled with; Immediate for a final digest.
	 * @param string $occurrence Day or week it was scheduled for, or {@see self::FLUSH}.
	 * @return void
	 */
	public static function handle_digest( $organizer = '', $frequency = '', $occurrence = '' ) {
		unset( $occurrence );
		$organizer = (string) $organizer;
		if ( ! SaleAlertSettings::valid_key( $organizer ) ) {
			return;
		}
		$settings = SaleAlertSettings::organizer( $organizer );
		self::schedule_digest( $organizer );
		if ( SaleAlertSettings::IMMEDIATE !== $frequency && $settings['frequency'] !== $frequency ) {
			return;
		}
		( new self() )->send_digest( $organizer );
	}

	/**
	 * Queue the alert of a confirmed purchase's paid transaction, once.
	 *
	 * @param object $signup      Confirmed signup row.
	 * @param object $transaction Connector transaction.
	 * @return bool Whether a worker was scheduled.
	 */
	public function queue( $signup, $transaction ) {
		if ( ! SaleAlertSettings::any_enabled() || ! self::paid_sale( self::transaction_fields( $transaction ) ) ) {
			return false;
		}

		$transaction_id = (int) $transaction->id;
		$owner_id       = $this->source->owner_of( (int) ( $signup->event_date_id ?? 0 ) );
		$organizer      = $owner_id ? $this->route( $this->source->stored_organizer( $owner_id ) ) : null;

		$this->log->queue( $transaction_id, $owner_id, (string) $organizer );
		$row = $this->log->get( $transaction_id );
		if ( ! $row || SaleAlertLog::QUEUED !== $row['state'] ) {
			return false;
		}

		Cron::ensure_recurring( self::RECOVERY_HOOK, 'hourly', time() + HOUR_IN_SECONDS );
		return true === Cron::ensure_single( time(), self::WORKER_HOOK, array( $transaction_id ) );
	}

	/**
	 * Prepare and send one queued alert.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return string The row's state afterwards, or '' when another worker has it.
	 */
	public function process( $transaction_id ) {
		$transaction_id = (int) $transaction_id;
		if ( ! $this->log->transition( $transaction_id, SaleAlertLog::QUEUED, SaleAlertLog::CLAIMED ) ) {
			return '';
		}

		$row      = $this->log->get( $transaction_id );
		$decision = $this->decide( $row );

		if ( 'wait' === $decision['action'] ) {
			$this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::QUEUED );
			Cron::ensure_single( time() + self::RECHECK_AFTER, self::WORKER_HOOK, array( $transaction_id ) );
			return SaleAlertLog::QUEUED;
		}

		if ( 'skip' === $decision['action'] ) {
			$this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::SKIPPED, $decision['reason'] );
			return SaleAlertLog::SKIPPED;
		}

		if ( 'digest' === $decision['action'] ) {
			if ( ! $this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::PENDING ) ) {
				return '';
			}
			self::schedule_digest( $row['organizer_id'] );
			return SaleAlertLog::PENDING;
		}

		// From here on Telegram may receive the request.
		if ( ! $this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::SENDING ) ) {
			return '';
		}

		try {
			$result = $this->provider->send_html( $decision['chat_id'], $decision['html'] );
		} catch ( \Throwable $e ) {
			$result = array(
				'state' => SaleAlertLog::UNCERTAIN,
				'code'  => 'internal_error',
			);
		}

		$state = in_array( $result['state'], array( SaleAlertLog::SENT, SaleAlertLog::FAILED ), true ) ? $result['state'] : SaleAlertLog::UNCERTAIN;
		$this->log->transition( $transaction_id, SaleAlertLog::SENDING, $state, (string) $result['code'] );
		return $state;
	}

	/**
	 * Finish work a stopped worker left behind: an alert claimed but not
	 * yet sent is queued again; one that may have reached Telegram is
	 * recorded as uncertain. Queued alerts are then processed.
	 *
	 * @return void
	 */
	public function recover() {
		$stale = time() - self::STALE_AFTER;
		foreach ( $this->log->in_state( SaleAlertLog::CLAIMED, $stale ) as $transaction_id ) {
			$this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::QUEUED );
		}
		foreach ( $this->log->in_state( SaleAlertLog::SENDING, $stale ) as $transaction_id ) {
			$this->log->transition( $transaction_id, SaleAlertLog::SENDING, SaleAlertLog::UNCERTAIN, self::REASON_INTERRUPTED );
		}
		foreach ( $this->log->in_state( SaleAlertLog::QUEUED ) as $transaction_id ) {
			$this->process( $transaction_id );
		}

		// Sales pending for an organizer that sends immediately now (a final
		// digest that never ran) go out; digest organizers keep their next
		// digest scheduled.
		$settings = SaleAlertSettings::get();
		$pending  = $this->log->pending_counts();
		foreach ( array_unique( array_merge( array_keys( $settings['organizers'] ), array_keys( $pending ) ) ) as $organizer ) {
			$organizer = (string) $organizer;
			$current   = $settings['organizers'][ $organizer ] ?? SaleAlertSettings::organizer_defaults();
			if ( SaleAlertSettings::is_digest( $current ) ) {
				self::schedule_digest( $organizer );
			} elseif ( ! empty( $pending[ $organizer ] ) ) {
				$this->send_digest( $organizer );
			}
		}
	}

	/**
	 * Send an organizer's pending sales as one digest.
	 *
	 * Nothing is claimed while the organizer's switch is off or while the
	 * Telegram credentials have a problem: the sales stay pending. Each claimed sale is checked again as a single
	 * alert would be; one that no longer qualifies is skipped with its
	 * reason. Nothing is sent when no sale is left.
	 *
	 * @param string $organizer Organizer key.
	 * @return string The digest's state: sent, uncertain, or pending again
	 *     after Telegram refused it; '' when nothing was sent.
	 */
	public function send_digest( $organizer ) {
		$organizer = (string) $organizer;
		$current   = SaleAlertSettings::get()['organizers'][ $organizer ] ?? null;
		if ( null === $current || ! $current['enabled'] || $this->provider->credential_problem() ) {
			return '';
		}

		$sales = array();
		foreach ( $this->log->claim_pending( $organizer, wp_generate_uuid4() ) as $transaction_id ) {
			$checked = $this->check_sale( $this->log->get( $transaction_id ) );
			if ( 'wait' === $checked['action'] ) {
				$this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::PENDING );
				continue;
			}
			if ( 'skip' === $checked['action'] ) {
				$this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::SKIPPED, $checked['reason'] );
				continue;
			}
			$sales[ $transaction_id ] = self::summary( $checked['sale'] );
		}

		// From here on Telegram may receive the request.
		foreach ( array_keys( $sales ) as $transaction_id ) {
			if ( ! $this->log->transition( $transaction_id, SaleAlertLog::CLAIMED, SaleAlertLog::SENDING ) ) {
				unset( $sales[ $transaction_id ] );
			}
		}
		if ( ! $sales ) {
			return '';
		}

		try {
			$result = $this->provider->send_html( $current['chat_id'], SaleAlertFormatter::digest_html( array_values( $sales ) ) );
		} catch ( \Throwable $e ) {
			$result = array(
				'state' => SaleAlertLog::UNCERTAIN,
				'code'  => 'internal_error',
			);
		}

		$state = in_array( $result['state'], array( SaleAlertLog::SENT, SaleAlertLog::FAILED ), true ) ? $result['state'] : SaleAlertLog::UNCERTAIN;
		// Refused for sure: nothing was posted, so the next digest retries.
		$final = SaleAlertLog::FAILED === $state ? SaleAlertLog::PENDING : $state;
		foreach ( array_keys( $sales ) as $transaction_id ) {
			$this->log->transition( $transaction_id, SaleAlertLog::SENDING, $final, (string) $result['code'] );
		}
		return $final;
	}

	/**
	 * Make sure a digest organizer's next digest is scheduled. An event
	 * already queued for its cadence is kept, so an overdue digest still
	 * runs.
	 *
	 * @param string $organizer Organizer key.
	 * @return bool Whether a digest is scheduled.
	 */
	public static function schedule_digest( $organizer ) {
		$organizer = (string) $organizer;
		$settings  = SaleAlertSettings::organizer( $organizer );
		if ( ! $settings['enabled'] || ! SaleAlertSettings::is_digest( $settings ) ) {
			return false;
		}
		foreach ( self::scheduled_digests( $organizer ) as list( , $args ) ) {
			if ( $args[1] === $settings['frequency'] ) {
				return true;
			}
		}

		$due = SalesSummaryPeriod::next_due( $settings, WeeklySendSchedule::now() );
		return true === Cron::ensure_single(
			$due->getTimestamp(),
			self::DIGEST_HOOK,
			array( $organizer, $settings['frequency'], SalesSummaryPeriod::occurrence( $settings['frequency'], $due ) )
		);
	}

	/**
	 * Bring an organizer's queued digests in line with its settings after
	 * they were saved.
	 *
	 * A queued digest that still matches the cadence, weekday and time is
	 * kept, overdue or not; any other is removed and the next one
	 * scheduled, carrying the pending sales forward. An organizer that
	 * sends immediately now gets one final digest of its pending sales.
	 *
	 * @param string            $organizer Organizer key.
	 * @param SaleAlertLog|null $log       Alert records.
	 * @return void
	 */
	public static function reschedule_digest( $organizer, $log = null ) {
		$organizer = (string) $organizer;
		$settings  = SaleAlertSettings::organizer( $organizer );
		$active    = $settings['enabled'];
		$digest    = $active && SaleAlertSettings::is_digest( $settings );

		foreach ( self::scheduled_digests( $organizer ) as list( $timestamp, $args ) ) {
			// A final digest stays only while the organizer sends immediately;
			// a scheduled one only while it still matches the settings.
			$keep = self::FLUSH === $args[2] ? ! $digest : $digest && self::matches( $settings, $timestamp, $args );
			if ( ! $keep ) {
				wp_unschedule_event( $timestamp, self::DIGEST_HOOK, $args );
			}
		}

		if ( $digest ) {
			self::schedule_digest( $organizer );
		} elseif ( $active && ! empty( ( $log ? $log : new SaleAlertLog() )->pending_counts()[ $organizer ] ) ) {
			Cron::ensure_single( time(), self::DIGEST_HOOK, array( $organizer, SaleAlertSettings::IMMEDIATE, self::FLUSH ) );
		}
	}

	/**
	 * When an organizer's next digest is sent.
	 *
	 * @param string $organizer Organizer key.
	 * @return int|null Unix time, or null when none is scheduled.
	 */
	public static function next_digest( $organizer ) {
		$times = array_column( self::scheduled_digests( (string) $organizer ), 0 );
		return $times ? (int) min( $times ) : null;
	}

	/**
	 * Queued digests of one organizer.
	 *
	 * @param string $organizer Organizer key.
	 * @return array[] Each `array( timestamp, args )`.
	 */
	private static function scheduled_digests( $organizer ) {
		return array_values(
			array_filter(
				ScheduledSends::events( self::DIGEST_HOOK ),
				static function ( $event ) use ( $organizer ) {
					return 3 === count( $event[1] ) && $event[1][0] === $organizer;
				}
			)
		);
	}

	/**
	 * Whether a queued digest is one the settings would schedule.
	 *
	 * @param array $settings  Organizer settings.
	 * @param int   $timestamp When it runs.
	 * @param array $args      Its arguments.
	 * @return bool
	 */
	private static function matches( array $settings, $timestamp, array $args ) {
		if ( $args[1] !== $settings['frequency'] ) {
			return false;
		}
		$before = ( new \DateTimeImmutable( '@' . ( (int) $timestamp - 1 ) ) )->setTimezone( wp_timezone() );
		$due    = SalesSummaryPeriod::next_due( $settings, $before );
		return $due->getTimestamp() === (int) $timestamp && SalesSummaryPeriod::occurrence( $settings['frequency'], $due ) === $args[2];
	}

	/**
	 * What a digest lists of one sale.
	 *
	 * @param array $sale Sale from {@see SaleAlertSource::load()}.
	 * @return array
	 */
	private static function summary( array $sale ) {
		return array(
			'event_id' => (int) $sale['event']['id'],
			'title'    => $sale['event']['title'],
			'dates'    => $sale['dates'],
			'tickets'  => $sale['tickets'],
			'amount'   => $sale['transaction']['amount'],
			'currency' => $sale['transaction']['currency'],
		);
	}

	/**
	 * The organizer a stored assignment routes to now.
	 *
	 * @param string|null $stored Organizer UUID stored on the event, or null.
	 * @return string|null Organizer key, or null when it can't be resolved.
	 */
	public function route( $stored ) {
		if ( null === $stored || '' === $stored ) {
			return SalesSummarySettings::DEFAULT_ORGANIZER;
		}
		if ( ! $this->organizers->resolution_available() || null === $this->organizers->find( $stored ) ) {
			return null;
		}
		return (string) $stored;
	}

	/**
	 * What to do with a claimed alert now.
	 *
	 * @param array|null $row Alert record.
	 * @return array{action: string, reason?: string, chat_id?: string, html?: string}
	 */
	private function decide( $row ) {
		if ( ! $row ) {
			return self::skip( self::REASON_MISSING_TRANSACTION );
		}
		$checked = $this->check_sale( $row );
		if ( 'ok' !== $checked['action'] ) {
			return $checked;
		}
		$organizer = $row['organizer_id'];
		$sale      = $checked['sale'];

		// An organizer never set up has no destination (a warning); one
		// switched off is skipped on purpose. A saved switch is on only with
		// a valid destination ({@see SaleAlertSettings::sanitize()}).
		$settings = SaleAlertSettings::get()['organizers'][ $organizer ] ?? null;
		if ( null === $settings ) {
			return self::skip( self::REASON_MISSING_DESTINATION );
		}
		if ( ! $settings['enabled'] ) {
			return self::skip( self::REASON_ORGANIZER_DISABLED );
		}
		if ( SaleAlertSettings::is_digest( $settings ) ) {
			return array( 'action' => 'digest' );
		}

		$problem = $this->provider->credential_problem();
		if ( $problem ) {
			return self::skip( $problem['code'] );
		}

		return array(
			'action'  => 'send',
			'chat_id' => $settings['chat_id'],
			'html'    => SaleAlertFormatter::html(
				array(
					'title'    => $sale['event']['title'],
					'dates'    => $sale['dates'],
					'tickets'  => $sale['tickets'],
					'amount'   => $sale['transaction']['amount'],
					'currency' => $sale['transaction']['currency'],
				)
			),
		);
	}

	/**
	 * Whether a recorded sale still qualifies for its organizer: a paid,
	 * fully confirmed purchase of one event that still belongs to the
	 * organizer it was queued for.
	 *
	 * @param array|null $row Alert record.
	 * @return array{action: string, reason?: string, sale?: array} `ok` with the sale, `wait` or `skip`.
	 */
	private function check_sale( $row ) {
		if ( ! $row ) {
			return self::skip( self::REASON_MISSING_TRANSACTION );
		}

		$sale = $this->source->load( $row['transaction_id'] );
		if ( null === $sale ) {
			return self::skip( self::REASON_MISSING_TRANSACTION );
		}
		if ( ! self::paid_sale( $sale['transaction'] ) ) {
			return self::skip( self::REASON_NOT_PAID );
		}
		if ( ! $sale['purchases'] ) {
			return self::skip( self::REASON_UNATTRIBUTED );
		}

		foreach ( $sale['purchases'] as $purchase ) {
			if ( 'pending_payment' === $purchase['status'] ) {
				$queued_at = strtotime( $row['created_at'] . ' UTC' );
				return false !== $queued_at && time() - $queued_at < self::CONFIRMATION_WAIT ? array( 'action' => 'wait' ) : self::skip( self::REASON_INCOMPLETE );
			}
		}

		// Every purchase confirmed by this payment, for one event: only then
		// does the transaction's total describe them.
		foreach ( $sale['purchases'] as $purchase ) {
			if ( 'confirmed' !== $purchase['status'] || (int) $purchase['transaction_id'] !== (int) $row['transaction_id'] ) {
				return self::skip( self::REASON_INCONSISTENT );
			}
		}
		if ( 1 !== count( $sale['owner_ids'] ) || ! $sale['event'] || (int) $sale['event']['id'] !== (int) $row['event_id'] || ! $sale['tickets'] ) {
			return self::skip( self::REASON_INCONSISTENT );
		}

		$organizer = $this->route( $sale['event']['organizer_id'] );
		if ( null === $organizer ) {
			return self::skip( self::REASON_ORGANIZER_UNAVAILABLE );
		}
		if ( $organizer !== $row['organizer_id'] ) {
			return self::skip( self::REASON_ASSIGNMENT_CHANGED );
		}

		return array(
			'action' => 'ok',
			'sale'   => $sale,
		);
	}

	/**
	 * Whether a transaction is a paid Get Tickets checkout with a charge.
	 *
	 * @param array $transaction `{ status, amount, source }`.
	 * @return bool
	 */
	private static function paid_sale( array $transaction ) {
		return 'paid' === $transaction['status']
			&& (float) $transaction['amount'] > 0
			&& PaymentAttribution::SOURCE_GET_TICKETS === $transaction['source'];
	}

	/**
	 * The fields of a Connector transaction object the alert checks.
	 *
	 * @param object $transaction Connector transaction.
	 * @return array{status: string, amount: float, source: string}
	 */
	private static function transaction_fields( $transaction ) {
		$metadata = \FairEvents\Services\PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		return array(
			'status' => (string) ( $transaction->status ?? '' ),
			'amount' => (float) ( $transaction->amount ?? 0 ),
			'source' => (string) ( $metadata['source'] ?? '' ),
		);
	}

	/**
	 * A skip decision.
	 *
	 * @param string $reason Reason code.
	 * @return array
	 */
	private static function skip( $reason ) {
		return array(
			'action' => 'skip',
			'reason' => $reason,
		);
	}
}
