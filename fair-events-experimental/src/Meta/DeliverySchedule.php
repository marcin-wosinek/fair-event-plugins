<?php
/**
 * WP-Cron wake-ups for queued Meta Conversions delivery.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Meta;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/**
 * Keeps one delivery wake-up scheduled no later than the earliest
 * outstanding outbox work: a due or retrying row, or a claim whose lease
 * expires. Every wake-up runs {@see Conversions::deliver_due()}, which
 * reconciles again when it finishes, so the earliest wake-up is the only one
 * needed.
 *
 * Each wake-up carries its own timestamp as its argument. WP-Cron refuses a
 * second event of the same hook and arguments within ten minutes of
 * another, so without it new work could not be scheduled ahead of a nearby
 * retry. Wake-ups queued before this class existed have no arguments and
 * still run the same worker.
 *
 * A failed or unverified schedule is recorded in {@see FAILURE_OPTION} —
 * only a sanitized code and a timestamp — and shown to administrators until
 * a later reconciliation verifies a wake-up again.
 */
class DeliverySchedule {
	public const FAILURE_OPTION = 'fair_events_experimental_meta_schedule_failure';
	public const CODE_LENGTH    = 40;

	/** @var Outbox */
	private $outbox;

	/** @var int[] Wake-ups this instance scheduled to cover its worker's claims. */
	private $claim_wakeups = array();

	/** @param Outbox|null $outbox Outbox to read outstanding work from. */
	public function __construct( $outbox = null ) {
		$this->outbox = $outbox ? $outbox : new Outbox();
	}

	/**
	 * Schedule a wake-up for the earliest outstanding work, if any. Nothing is
	 * scheduled for an empty queue, and other wake-ups are never removed for
	 * lack of work: a concurrent request may just have queued some.
	 *
	 * Wake-ups this instance's {@see cover_claim()} added are released here: once the
	 * outbox is read again, any claim still held is covered from its stored
	 * lease, so an early recovery wake-up does not outlive its worker. They
	 * stay in place when no replacement can be verified.
	 *
	 * @return bool Whether a wake-up covers the outstanding work.
	 */
	public function reconcile() {
		$released            = $this->claim_wakeups;
		$this->claim_wakeups = array();
		$due                 = $this->outbox->next_wake_at();
		if ( null === $due ) {
			self::remove( $released );
			self::clear_failure();
			return true;
		}
		return $this->schedule_by( $due, $released )['ok'];
	}

	/**
	 * The cheap check feature initialization runs on every request: the
	 * outbox is read only when no wake-up is scheduled at all, or the last
	 * scheduling attempt failed. It repairs scheduling only; queued events
	 * are always sent by the worker, never by the request.
	 *
	 * @return bool Whether a wake-up covers the outstanding work.
	 */
	public function reconcile_if_needed() {
		if ( self::wakeups() && ! self::failure()['active'] ) {
			return true;
		}
		return $this->reconcile();
	}

	/**
	 * Make sure a wake-up runs no later than `$timestamp`. A new wake-up is
	 * verified before any later one is removed, so a failed replacement
	 * leaves the existing schedule in place, and only later wake-ups are
	 * ever removed, so concurrent calls cannot remove an earlier one.
	 *
	 * @param int $timestamp Latest acceptable run time; a past time means now.
	 * @return bool Whether a wake-up is verified at or before that time.
	 */
	public function ensure_by( $timestamp ) {
		return $this->schedule_by( $timestamp, array() )['ok'];
	}

	/**
	 * Cover a claim's lease end before its worker sends, so an interrupted
	 * worker is recovered without its own completion handler. A wake-up
	 * added here is released by this instance's next {@see reconcile()}.
	 *
	 * @param int $lease_end Unix time the claim's lease expires.
	 * @return bool Whether a wake-up is verified at or before that time.
	 */
	public function cover_claim( $lease_end ) {
		$result = $this->schedule_by( $lease_end, array() );
		if ( null !== $result['scheduled'] ) {
			$this->claim_wakeups[] = $result['scheduled'];
		}
		return $result['ok'];
	}

	/**
	 * @param int   $timestamp Latest acceptable run time; a past time means now.
	 * @param int[] $released  Wake-ups to drop unless exactly on time.
	 * @return array `ok` (bool) and `scheduled` (the timestamp this call added, or null).
	 */
	private function schedule_by( $timestamp, $released ) {
		$target    = max( (int) $timestamp, time() );
		$covering  = self::covering( $target, $released );
		$scheduled = null;
		if ( null === $covering ) {
			$result = wp_schedule_single_event( $target, Conversions::DELIVERY_HOOK, array( $target ), true );
			// Verify by reading the schedule back: a concurrent call may have
			// scheduled the same second first, which WP-Cron reports as a
			// duplicate although the wake-up is in place.
			$covering = self::covering( $target, $released );
			if ( null === $covering ) {
				self::record_failure( is_wp_error( $result ) ? $result->get_error_code() : 'not_scheduled' );
				return array(
					'ok'        => false,
					'scheduled' => null,
				);
			}
			$scheduled = true === $result ? $target : null;
		}
		foreach ( self::wakeups() as $wakeup ) {
			$early = in_array( $wakeup['timestamp'], $released, true ) && $wakeup !== $covering;
			// A wake-up that could not be removed only costs one empty run.
			if ( $wakeup['timestamp'] > $target || $early ) {
				wp_unschedule_event( $wakeup['timestamp'], Conversions::DELIVERY_HOOK, $wakeup['args'] );
			}
		}
		self::clear_failure();
		return array(
			'ok'        => true,
			'scheduled' => $scheduled,
		);
	}

	/**
	 * @param int   $target   Latest acceptable run time.
	 * @param int[] $released Wake-ups that count only when exactly on time.
	 * @return array|null Earliest wake-up that covers the target, or null.
	 */
	private static function covering( $target, $released ) {
		foreach ( self::wakeups() as $wakeup ) {
			if ( $wakeup['timestamp'] > $target ) {
				return null;
			}
			if ( $wakeup['timestamp'] === $target || ! in_array( $wakeup['timestamp'], $released, true ) ) {
				return $wakeup;
			}
		}
		return null;
	}

	/** @param int[] $timestamps Wake-ups this instance added. */
	private static function remove( $timestamps ) {
		foreach ( $timestamps as $timestamp ) {
			wp_unschedule_event( $timestamp, Conversions::DELIVERY_HOOK, array( $timestamp ) );
		}
	}

	/** @return array[] Scheduled delivery wake-ups, each `timestamp` and `args`, earliest first. */
	public static function wakeups() {
		$wakeups = array();
		$crons   = _get_cron_array();
		foreach ( is_array( $crons ) ? $crons : array() as $timestamp => $hooks ) {
			foreach ( $hooks[ Conversions::DELIVERY_HOOK ] ?? array() as $event ) {
				$wakeups[] = array(
					'timestamp' => (int) $timestamp,
					'args'      => isset( $event['args'] ) && is_array( $event['args'] ) ? $event['args'] : array(),
				);
			}
		}
		usort( $wakeups, static fn( $a, $b ) => $a['timestamp'] - $b['timestamp'] );
		return $wakeups;
	}

	/**
	 * @return array `active` (bool), `code` (sanitized string or null) and
	 *               `failed_at` (UTC MySQL datetime or null) of the last
	 *               scheduling failure.
	 */
	public static function failure() {
		$stored = get_option( self::FAILURE_OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();
		return array(
			'active'    => ! empty( $stored['active'] ),
			'code'      => isset( $stored['code'] ) ? (string) $stored['code'] : null,
			'failed_at' => isset( $stored['failed_at'] ) ? (string) $stored['failed_at'] : null,
		);
	}

	/**
	 * Scheduling health for administrators. The last failure stays readable
	 * after recovery; `healthy` says whether it is still unresolved.
	 *
	 * @return array
	 */
	public static function status() {
		$failure = self::failure();
		return array(
			'healthy'               => ! $failure['active'],
			'last_failure_code'     => $failure['code'],
			'last_failure_at'       => $failure['failed_at'],
			'last_failure_at_local' => $failure['failed_at'] ? wp_date(
				get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
				strtotime( $failure['failed_at'] . ' UTC' )
			) : null,
		);
	}

	/** @param mixed $code WP_Error code or our own reason. */
	private static function record_failure( $code ) {
		$code = substr( sanitize_key( (string) $code ), 0, self::CODE_LENGTH );
		update_option(
			self::FAILURE_OPTION,
			array(
				'active'    => true,
				'code'      => '' !== $code ? $code : 'not_scheduled',
				'failed_at' => current_time( 'mysql', true ),
			),
			true
		);
	}

	/** Mark the last failure resolved; written only when it was still active. */
	private static function clear_failure() {
		$failure = self::failure();
		if ( ! $failure['active'] ) {
			return;
		}
		update_option(
			self::FAILURE_OPTION,
			array(
				'active'    => false,
				'code'      => $failure['code'],
				'failed_at' => $failure['failed_at'],
			),
			true
		);
	}
}
