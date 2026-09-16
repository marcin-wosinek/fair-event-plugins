<?php
/**
 * Payment Hooks for Fair Events Get Tickets
 *
 * Listens to fair-payments-connector actions to update get-tickets signup status.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

defined( 'WPINC' ) || die;

/**
 * Hooks into fair-payments-connector webhook to handle ticket payment completion.
 */
class PaymentHooks {

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

		// Cron to expire stale pending_payment rows.
		add_action( 'fair_events_cleanup_expired_ticket_signups', array( static::class, 'cleanup_expired_signups' ) );
		if ( ! wp_next_scheduled( 'fair_events_cleanup_expired_ticket_signups' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'hourly', 'fair_events_cleanup_expired_ticket_signups' );
		}
	}

	/**
	 * On payment paid: flip matching get-tickets signup(s) to confirmed.
	 *
	 * A 'multiple_instances' ticket-type purchase creates one signup row per
	 * chosen occurrence under a single transaction; every other purchase
	 * creates exactly one row, so resolve_signup_ids() always returns at
	 * least the single-row case.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_paid( $payment, $transaction ) {
		foreach ( self::resolve_signup_ids( $transaction ) as $signup_id ) {
			if ( ! \FairEvents\Models\EventSignup::confirm_paid( $signup_id ) ) {
				continue;
			}

			$signup = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
			if ( $signup ) {
				/**
				 * Fires when a base-route signup's payment is confirmed.
				 *
				 * @param object $signup      The fair_events_signups row (status already 'confirmed').
				 * @param object $transaction Transaction object from fair-payments-connector.
				 */
				do_action( 'fair_events_signup_confirmed', $signup, $transaction );
			}
		}
	}

	/**
	 * On payment failed/canceled: mark the signup(s) as failed.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_failed( $payment, $transaction ) {
		foreach ( self::resolve_signup_ids( $transaction ) as $signup_id ) {
			if ( ! \FairEvents\Models\EventSignup::fail_pending( $signup_id ) ) {
				continue;
			}

			$signup = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
			if ( $signup ) {
				/**
				 * Fires when a base-route signup's payment fails/cancels/expires.
				 *
				 * @param object $signup      The fair_events_signups row (status already 'failed').
				 * @param object $transaction Transaction object from fair-payments-connector.
				 */
				do_action( 'fair_events_signup_payment_failed', $signup, $transaction );
			}
		}
	}

	/**
	 * Retain and mark expired pending-payment rows.
	 *
	 * @return void
	 */
	public static function cleanup_expired_signups() {
		\FairEvents\Models\EventSignup::expire_pending();
	}

	/**
	 * Prepare an event summary for a transaction-view response.
	 *
	 * @param array|null $prepared       Current value (null if not yet prepared).
	 * @param int|null   $event_date_id  Event date ID.
	 * @return array|null Summary with id, title, start_datetime, manage_url — or null.
	 */
	public static function prepare_event( $prepared, $event_date_id ) {
		if ( null !== $prepared || empty( $event_date_id ) ) {
			return $prepared;
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $event_date_id );

		if ( ! $event_date ) {
			return null;
		}

		return array(
			'id'             => (int) $event_date->id,
			'title'          => $event_date->get_display_title(),
			'start_datetime' => $event_date->start_datetime,
			'manage_url'     => admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . (int) $event_date->id ),
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
