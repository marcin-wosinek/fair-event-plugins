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

		// Cron to expire stale pending_payment rows.
		add_action( 'fair_events_cleanup_expired_ticket_signups', array( static::class, 'cleanup_expired_signups' ) );
		if ( ! wp_next_scheduled( 'fair_events_cleanup_expired_ticket_signups' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'hourly', 'fair_events_cleanup_expired_ticket_signups' );
		}
	}

	/**
	 * On payment paid: flip matching get-tickets signup to confirmed.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_paid( $payment, $transaction ) {
		$signup_id = self::resolve_signup_id( $transaction );
		if ( $signup_id ) {
			\FairEvents\Models\EventSignup::update_status( $signup_id, 'confirmed' );
		}
	}

	/**
	 * On payment failed/canceled: mark the signup as failed.
	 *
	 * @param object $payment     Payment object from fair-payments-connector.
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_payment_failed( $payment, $transaction ) {
		$signup_id = self::resolve_signup_id( $transaction );
		if ( $signup_id ) {
			\FairEvents\Models\EventSignup::update_status( $signup_id, 'failed' );
		}
	}

	/**
	 * Remove expired pending_payment rows.
	 *
	 * @return void
	 */
	public static function cleanup_expired_signups() {
		\FairEvents\Models\EventSignup::delete_expired_pending();
	}

	/**
	 * Resolve the signup ID from a transaction, returning 0 if not a get-tickets transaction.
	 *
	 * @param object $transaction Transaction object.
	 * @return int Signup ID or 0.
	 */
	private static function resolve_signup_id( $transaction ) {
		if ( ! isset( $transaction->metadata ) ) {
			return 0;
		}

		$metadata = is_string( $transaction->metadata )
			? json_decode( $transaction->metadata, true )
			: (array) $transaction->metadata;

		if ( ( $metadata['source'] ?? '' ) !== 'fair-events-get-tickets' ) {
			return 0;
		}

		if ( ! empty( $metadata['signup_id'] ) ) {
			return (int) $metadata['signup_id'];
		}

		// Fall back to lookup by transaction_id.
		$signup = \FairEvents\Models\EventSignup::get_by_transaction_id( (int) $transaction->id );
		return $signup ? (int) $signup->id : 0;
	}
}
