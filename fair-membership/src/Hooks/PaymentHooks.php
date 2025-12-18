<?php
/**
 * Payment webhook hooks for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Hooks;

defined( 'WPINC' ) || die;

use FairMembership\Models\UserFee;

/**
 * Handles payment webhook callbacks from fair-payment plugin
 */
class PaymentHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'fair_payment_paid', array( $this, 'handle_payment_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( $this, 'handle_payment_failed' ), 10, 2 );
	}

	/**
	 * Handle successful payment webhook
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction object from database.
	 * @return void
	 */
	public function handle_payment_paid( $payment, $transaction ) {
		// Decode transaction metadata
		$metadata = json_decode( $transaction->metadata, true );

		// Check if this is a fair-membership transaction
		if ( ! isset( $metadata['plugin'] ) || 'fair-membership' !== $metadata['plugin'] ) {
			return;
		}

		// Check if this is a user fee payment
		if ( ! isset( $metadata['user_fee_id'] ) ) {
			return;
		}

		// Load the user fee
		$user_fee = UserFee::get_by_id( $metadata['user_fee_id'] );

		if ( ! $user_fee ) {
			error_log(
				sprintf(
					'Fair Membership: User fee #%d not found for transaction #%d',
					$metadata['user_fee_id'],
					$transaction->id
				)
			);
			return;
		}

		// Mark fee as paid
		try {
			$user_fee->mark_as_paid();

			// Log successful payment processing
			error_log(
				sprintf(
					'Fair Membership: User fee #%d marked as paid via transaction #%d (Mollie payment: %s)',
					$user_fee->id,
					$transaction->id,
					$payment->id
				)
			);
		} catch ( \Exception $e ) {
			error_log(
				sprintf(
					'Fair Membership: Failed to mark user fee #%d as paid: %s',
					$user_fee->id,
					$e->getMessage()
				)
			);
		}
	}

	/**
	 * Handle failed payment webhook
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction object from database.
	 * @return void
	 */
	public function handle_payment_failed( $payment, $transaction ) {
		// Decode transaction metadata
		$metadata = json_decode( $transaction->metadata, true );

		// Check if this is a fair-membership transaction
		if ( ! isset( $metadata['plugin'] ) || 'fair-membership' !== $metadata['plugin'] ) {
			return;
		}

		// Check if this is a user fee payment
		if ( ! isset( $metadata['user_fee_id'] ) ) {
			return;
		}

		// Load the user fee
		$user_fee = UserFee::get_by_id( $metadata['user_fee_id'] );

		if ( ! $user_fee ) {
			return;
		}

		// Log failed payment
		error_log(
			sprintf(
				'Fair Membership: Payment failed for user fee #%d, transaction #%d (Mollie payment: %s, status: %s)',
				$user_fee->id,
				$transaction->id,
				$payment->id,
				$payment->status
			)
		);

		// Reset status to pending if it was pending_payment
		if ( 'pending_payment' === $user_fee->status ) {
			try {
				$user_fee->status = 'pending';
				$user_fee->save();

				error_log(
					sprintf(
						'Fair Membership: User fee #%d status reset to pending after payment failure',
						$user_fee->id
					)
				);
			} catch ( \Exception $e ) {
				error_log(
					sprintf(
						'Fair Membership: Failed to reset user fee #%d status: %s',
						$user_fee->id,
						$e->getMessage()
					)
				);
			}
		}
	}
}
