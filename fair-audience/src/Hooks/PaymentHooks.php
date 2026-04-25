<?php
/**
 * Payment Hooks
 *
 * Listens to fair-payment webhook actions to update fee payment status.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Database\FeePaymentRepository;
use FairAudience\Database\FeeAuditLogRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Services\EmailService;

defined( 'WPINC' ) || die;

/**
 * Hooks into fair-payment webhook to handle fee payment completion.
 */
class PaymentHooks {

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_action( 'fair_payment_paid', array( static::class, 'handle_payment_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_payment_failed' ), 10, 2 );
		add_action( 'fair_payment_paid', array( static::class, 'handle_signup_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_signup_failed' ), 10, 2 );

		add_action( 'fair_audience_event_signup_paid', array( static::class, 'send_signup_confirmation_email' ), 10, 2 );

		add_filter( 'fair_payment_resolve_participant_id', array( static::class, 'resolve_participant_id' ), 10, 2 );
		add_filter( 'fair_payment_prepare_participant', array( static::class, 'prepare_participant' ), 10, 2 );
		add_action( 'fair_payment_backfill_participant_ids', array( static::class, 'backfill_participant_ids' ) );

		// Expire pending signup rows whose payment never completed.
		add_action( 'fair_audience_cleanup_expired_signups', array( static::class, 'cleanup_expired_signups' ) );
		if ( ! wp_next_scheduled( 'fair_audience_cleanup_expired_signups' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fair_audience_every_five_minutes', 'fair_audience_cleanup_expired_signups' );
		}
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );
	}

	/**
	 * Resolve a participant ID from transaction creation context.
	 *
	 * Resolution order: explicit metadata → email lookup → wp_user_id lookup.
	 * Returns null when no participant matches; fair-payment then falls back
	 * to storing only user_id on the transaction row.
	 *
	 * @param int|null $participant_id Current value (null if not yet resolved).
	 * @param array    $context        Context: user_id, email, metadata.
	 * @return int|null Participant ID or null.
	 */
	public static function resolve_participant_id( $participant_id, $context ) {
		if ( null !== $participant_id ) {
			return $participant_id;
		}

		$repository = new ParticipantRepository();

		if ( ! empty( $context['metadata']['participant_id'] ) ) {
			$participant = $repository->get_by_id( (int) $context['metadata']['participant_id'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		if ( ! empty( $context['email'] ) ) {
			$participant = $repository->get_by_email( $context['email'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		if ( ! empty( $context['user_id'] ) ) {
			$participant = $repository->get_by_user_id( (int) $context['user_id'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		return null;
	}

	/**
	 * Prepare a participant summary for API responses.
	 *
	 * @param array|null $prepared       Current value (null if not yet prepared).
	 * @param int|null   $participant_id Participant ID.
	 * @return array|null Summary with id, name, email, admin_url — or null.
	 */
	public static function prepare_participant( $prepared, $participant_id ) {
		if ( null !== $prepared || empty( $participant_id ) ) {
			return $prepared;
		}

		$repository  = new ParticipantRepository();
		$participant = $repository->get_by_id( (int) $participant_id );

		if ( ! $participant ) {
			return null;
		}

		$full_name = trim( $participant->name . ' ' . $participant->surname );

		return array(
			'id'        => (int) $participant->id,
			'name'      => $full_name,
			'email'     => $participant->email,
			'admin_url' => admin_url( 'admin.php?page=fair-audience-participant-detail&participant_id=' . (int) $participant->id ),
		);
	}

	/**
	 * Backfill participant_id on transactions that only have user_id.
	 *
	 * Triggered by fair-payment's v15 migration. Idempotent: only touches rows
	 * where participant_id IS NULL AND user_id IS NOT NULL, matching against
	 * the participants table by wp_user_id in a single UPDATE ... JOIN.
	 */
	public static function backfill_participant_ids() {
		global $wpdb;

		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t
				INNER JOIN %i AS p ON p.wp_user_id = t.user_id
				SET t.participant_id = p.id
				WHERE t.participant_id IS NULL AND t.user_id IS NOT NULL',
				$transactions_table,
				$participants_table
			)
		);
	}

	/**
	 * Register a 5-minute cron schedule used by the signup expiry cleanup.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules['fair_audience_every_five_minutes'] ) ) {
			$schedules['fair_audience_every_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience' ),
			);
		}
		return $schedules;
	}

	/**
	 * Delete pending_payment rows whose payment window has elapsed.
	 *
	 * Protects against lost webhook deliveries: stale rows still hold a slot
	 * until this cleanup runs (or a new request triggers the capacity check,
	 * which already filters on payment_expires_at).
	 */
	public static function cleanup_expired_signups() {
		$repo = new EventParticipantRepository();
		$repo->delete_expired_pending_payments();
	}

	/**
	 * Flip a pending_payment event_participant row to signed_up when Mollie
	 * confirms the payment.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payment.
	 */
	public static function handle_signup_paid( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return;
		}

		$repo              = new EventParticipantRepository();
		$event_participant = $repo->get_by_transaction_id( (int) $transaction->id );
		if ( ! $event_participant || 'pending_payment' !== $event_participant->label ) {
			return;
		}

		$event_participant->label              = 'signed_up';
		$event_participant->payment_expires_at = null;
		$event_participant->save();

		do_action( 'fair_audience_event_signup_paid', $event_participant, $transaction );
	}

	/**
	 * Release the slot held by a pending_payment event_participant row when
	 * Mollie reports the payment failed/canceled/expired.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payment.
	 */
	public static function handle_signup_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return;
		}

		$repo              = new EventParticipantRepository();
		$event_participant = $repo->get_by_transaction_id( (int) $transaction->id );
		if ( ! $event_participant || 'pending_payment' !== $event_participant->label ) {
			return;
		}

		$event_participant->delete();

		do_action( 'fair_audience_event_signup_failed', $event_participant, $transaction );
	}

	/**
	 * Send confirmation email to buyer after paid event signup.
	 *
	 * @param object $event_participant EventParticipant row.
	 * @param object $transaction       Transaction row from fair-payment.
	 */
	public static function send_signup_confirmation_email( $event_participant, $transaction ) {
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( (int) $event_participant->participant_id );

		if ( ! $participant ) {
			return;
		}

		$event = get_post( $event_participant->event_id );

		$email_service = new EmailService();
		$email_service->send_signup_payment_confirmation( $participant, $event, $transaction );
	}

	/**
	 * Handle successful payment via Mollie webhook.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 */
	public static function handle_payment_paid( $payment, $transaction ) {
		// Check if this transaction has fee_payment_id in metadata.
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();

		if ( empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		$fee_payment_id = (int) $metadata['fee_payment_id'];

		$payment_repository   = new FeePaymentRepository();
		$audit_log_repository = new FeeAuditLogRepository();

		$fee_payment = $payment_repository->get_by_id( $fee_payment_id );

		if ( ! $fee_payment ) {
			return;
		}

		// Already paid, skip.
		if ( 'paid' === $fee_payment->status ) {
			return;
		}

		// Update fee payment status.
		$old_status                  = $fee_payment->status;
		$fee_payment->status         = 'paid';
		$fee_payment->paid_at        = current_time( 'mysql' );
		$fee_payment->transaction_id = $transaction->id;
		$fee_payment->save();

		// Log the action.
		$audit_log_repository->log_action(
			$fee_payment->id,
			'marked_paid',
			$old_status,
			'paid',
			__( 'Paid online via Mollie', 'fair-audience' )
		);
	}

	/**
	 * Handle failed/canceled/expired payment via Mollie webhook or sync.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 */
	public static function handle_payment_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();

		if ( empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		$fee_payment_id = (int) $metadata['fee_payment_id'];

		$payment_repository   = new FeePaymentRepository();
		$audit_log_repository = new FeeAuditLogRepository();

		$fee_payment = $payment_repository->get_by_id( $fee_payment_id );

		if ( ! $fee_payment ) {
			return;
		}

		// Only log for pending payments (already paid or canceled don't need logging).
		if ( 'pending' !== $fee_payment->status ) {
			return;
		}

		$audit_log_repository->log_action(
			$fee_payment->id,
			'payment_failed',
			'pending',
			$payment->status,
			sprintf(
				/* translators: %1$s: Mollie status, %2$d: transaction ID */
				__( 'Online payment %1$s (transaction #%2$d)', 'fair-audience' ),
				$payment->status,
				$transaction->id
			)
		);
	}
}
