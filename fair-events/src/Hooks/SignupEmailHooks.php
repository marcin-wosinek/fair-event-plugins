<?php
/**
 * Signup confirmation email hooks for Fair Events
 *
 * Sends fair-events' own baseline confirmation email on the free and paid
 * signup lifecycle actions, and a payment-failed email on the failed one, but
 * only on sites where fair-audience isn't active to send its own (richer)
 * versions instead — see #1360 and #1373.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Models\EventSignup;
use FairEvents\Services\EmailService;

defined( 'WPINC' ) || die;

/**
 * Hooks into the base signup lifecycle actions to send a confirmation email.
 */
class SignupEmailHooks {

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'fair_events_signup_created', array( static::class, 'handle_signup_created' ), 10, 6 );
		add_action( 'fair_events_signup_confirmed', array( static::class, 'handle_signup_confirmed' ), 10, 2 );
		add_action( 'fair_events_signup_payment_failed', array( static::class, 'handle_signup_payment_failed' ), 10, 2 );
	}

	/**
	 * Free-path signup: send the confirmation email immediately, since a free
	 * signup is confirmed on creation. Paid-but-unconfirmed signups
	 * (`$transaction_id` not null) must not get a premature email — those are
	 * handled by handle_signup_confirmed() once payment clears.
	 *
	 * @param int      $signup_id        The fair_events_signups row just created.
	 * @param int      $event_date_id    Event-date ID the signup targets.
	 * @param string   $name             Buyer name.
	 * @param string   $email            Buyer email.
	 * @param array    $ticket_selection Ticket selection details (unused here).
	 * @param int|null $transaction_id   fair-payments-connector transaction ID, or null on the free path.
	 * @return void
	 */
	public static function handle_signup_created( $signup_id, $event_date_id, $name, $email, $ticket_selection, $transaction_id ) {
		if ( null !== $transaction_id ) {
			return;
		}

		self::maybe_send_confirmation( $signup_id, $event_date_id, $name, $email );
	}

	/**
	 * Paid-path signup: send the confirmation email once payment is confirmed.
	 *
	 * @param object $signup      The fair_events_signups row (status already 'confirmed').
	 * @param object $transaction Transaction object from fair-payments-connector (unused here).
	 * @return void
	 */
	public static function handle_signup_confirmed( $signup, $transaction ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- required by the fair_events_signup_confirmed hook signature.
		self::maybe_send_confirmation( (int) $signup->id, (int) $signup->event_date_id, $signup->name, $signup->email );
	}

	/**
	 * Failed-path signup: send a payment-failed email once, unless
	 * fair-audience is active — it already sends its own failed-payment
	 * email via the same hook (see FairAudience\Hooks\SignupHookBridge).
	 * Dedupes per transaction via a transient so payment-webhook retries for
	 * the same failed attempt don't double-mail the buyer; a later, separate
	 * failed attempt gets its own transaction ID and so its own email.
	 *
	 * @param object $signup      The fair_events_signups row (status already 'failed').
	 * @param object $transaction Transaction object from fair-payments-connector.
	 * @return void
	 */
	public static function handle_signup_payment_failed( $signup, $transaction ) {
		if ( class_exists( \FairAudience\Hooks\SignupHookBridge::class ) ) {
			return;
		}

		$transaction_id = isset( $transaction->id ) ? (int) $transaction->id : 0;
		if ( $transaction_id > 0 ) {
			$transient_key = 'fair_events_payment_failed_email_' . $transaction_id;
			if ( get_transient( $transient_key ) ) {
				return;
			}
			set_transient( $transient_key, 1, HOUR_IN_SECONDS );
		}

		$ticket_type_id = isset( $signup->ticket_type_id ) ? (int) $signup->ticket_type_id : 0;
		$amount         = isset( $signup->amount ) ? (float) $signup->amount : 0.0;

		( new EmailService() )->send_signup_payment_failed( (int) $signup->id, (int) $signup->event_date_id, $signup->name, $signup->email, $ticket_type_id, $amount );
	}

	/**
	 * Send fair-events' own confirmation email, unless fair-audience is
	 * active — it already sends a richer confirmation via the same hooks, so
	 * sending here too would double-mail the buyer.
	 *
	 * @param int    $signup_id     The fair_events_signups row ID.
	 * @param int    $event_date_id Event-date ID the signup targets.
	 * @param string $name          Buyer name.
	 * @param string $email         Buyer email.
	 * @return void
	 */
	private static function maybe_send_confirmation( $signup_id, $event_date_id, $name, $email ) {
		if ( class_exists( \FairAudience\Hooks\SignupHookBridge::class ) ) {
			return;
		}

		$signup         = EventSignup::get_by_id( $signup_id );
		$ticket_type_id = $signup ? (int) $signup->ticket_type_id : 0;
		$amount         = $signup ? (float) $signup->amount : 0.0;

		( new EmailService() )->send_signup_confirmation( $signup_id, $event_date_id, $name, $email, $ticket_type_id, $amount );
	}
}
