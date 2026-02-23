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
}
