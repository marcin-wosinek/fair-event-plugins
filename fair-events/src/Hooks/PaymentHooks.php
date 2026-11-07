<?php
/**
 * Payment Hooks for Fair Events Get Tickets
 *
 * Listens to fair-payments-connector actions to update get-tickets signup status.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Core\Cron;
use FairEvents\Services\PurchaseLifecycle;

defined( 'WPINC' ) || die;

/**
 * Hooks into fair-payments-connector webhook to handle ticket payment completion.
 */
class PaymentHooks {

	public const CLEANUP_HOOK = 'fair_events_cleanup_expired_ticket_signups';

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'fair_payment_paid', array( static::class, 'handle_payment_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_payment_failed' ), 10, 2 );

		add_filter( 'fair_payment_prepare_event', array( static::class, 'prepare_event' ), 10, 2 );
		add_filter( 'fair_payment_validate_event_date_id', array( static::class, 'validate_event_date_id' ), 10, 2 );

		// Cron to expire stale pending_payment rows. Scheduling waits for
		// `init`: it runs every plugin's translated `cron_schedules` labels.
		add_action( self::CLEANUP_HOOK, array( static::class, 'cleanup_expired_signups' ) );
		add_action( 'init', array( static::class, 'schedule_cleanup' ), 11 );
	}

	/**
	 * Restore the hourly cleanup when it is missing, keeping an existing one.
	 *
	 * @return true|string True when it is scheduled, or a failure code.
	 */
	public static function schedule_cleanup() {
		return Cron::ensure_recurring( self::CLEANUP_HOOK, 'hourly', time() + MINUTE_IN_SECONDS );
	}

	/**
	 * Remove the hourly cleanup. Pending signups stay and expire once it runs again.
	 *
	 * @return void
	 */
	public static function unschedule() {
		wp_unschedule_hook( self::CLEANUP_HOOK );
	}

	/**
	 * On payment paid: flip matching get-tickets signup(s) to confirmed.
	 *
	 * After the payment history cutover the purchases come from the
	 * attempt's payment links (PurchaseLifecycle), so a late payment for a
	 * superseded attempt confirms its purchase too. Before it, they come
	 * from the transaction's metadata: a 'multiple_instances' ticket-type
	 * purchase creates one signup row per chosen occurrence under a single
	 * transaction; every other purchase creates exactly one row.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_paid( $payment, $transaction ) {
		if ( PurchaseLifecycle::active() ) {
			PurchaseLifecycle::handle_paid( $transaction );
			return;
		}

		foreach ( self::resolve_signup_ids( $transaction ) as $signup_id ) {
			if ( ! PurchaseLifecycle::confirm_paid_signup( $signup_id ) ) {
				continue;
			}

			$signup = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
			if ( $signup ) {
				PurchaseLifecycle::announce_confirmed( $signup, $transaction );
			}
		}
	}

	/**
	 * On payment failed/canceled: mark the signup(s) still awaiting this
	 * payment as failed.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_failed( $payment, $transaction ) {
		$failed = array();
		if ( PurchaseLifecycle::active() ) {
			$failed = PurchaseLifecycle::handle_failed( $transaction );
		} else {
			foreach ( self::resolve_signup_ids( $transaction ) as $signup_id ) {
				if ( \FairEvents\Models\EventSignup::fail_pending( $signup_id ) ) {
					$failed[] = $signup_id;
				}
			}
		}

		foreach ( $failed as $signup_id ) {
			PurchaseLifecycle::announce_failed( $signup_id, $transaction );
		}
	}

	/**
	 * Retain and mark expired pending-payment rows, and drop the checkout
	 * keys of purchases that ended unconfirmed long ago.
	 *
	 * @return void
	 */
	public static function cleanup_expired_signups() {
		\FairEvents\Models\EventSignup::expire_pending();
		\FairEvents\Models\CheckoutKey::delete_stale();
	}

	/**
	 * Prepare an event summary for a transaction-view response.
	 *
	 * @param array|null $prepared       Current value (null if not yet prepared).
	 * @param int|null   $event_date_id  Event date ID.
	 * @return array|null Summary with id, title, timing (start_date, end_date, start_time, end_time, all_day), manage_url — or null.
	 */
	public static function prepare_event( $prepared, $event_date_id ) {
		if ( null !== $prepared || empty( $event_date_id ) ) {
			return $prepared;
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id );

		if ( ! $event_date ) {
			return null;
		}

		return array_merge(
			array(
				'id'    => (int) $event_date->id,
				'title' => $event_date->get_display_title(),
			),
			$event_date->get_timing(),
			array(
				'manage_url' => admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . (int) $event_date->id ),
			)
		);
	}

	/**
	 * Validate that a submitted event_date_id belongs to a real event date row.
	 *
	 * @param bool $valid         Current value (false if not yet validated).
	 * @param int  $event_date_id Event date ID to validate.
	 * @return bool
	 */
	public static function validate_event_date_id( $valid, $event_date_id ) {
		if ( $valid ) {
			return $valid;
		}

		return (bool) \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id );
	}

	/**
	 * Resolve the signup ID(s) from a transaction, returning an empty array
	 * if not a get-tickets transaction.
	 *
	 * Delegates to EventSignup::resolve_signup_ids_from_transaction() so the
	 * retry/cancel REST routes resolve the exact same multi-row set.
	 *
	 * @param object $transaction Transaction object.
	 * @return int[] Signup IDs (empty when none apply).
	 */
	private static function resolve_signup_ids( $transaction ) {
		return \FairEvents\Models\EventSignup::resolve_signup_ids_from_transaction( $transaction );
	}
}
