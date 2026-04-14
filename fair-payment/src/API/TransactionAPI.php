<?php
/**
 * Transaction API
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Models\Transaction;
use FairPayment\Models\LineItem;
use FairPayment\Payment\MolliePaymentHandler;

defined( 'WPINC' ) || die;

/**
 * Internal PHP API for transaction and payment management
 */
class TransactionAPI {
	/**
	 * Create a new transaction with line items
	 *
	 * @param array $line_items Array of line items with name, quantity, amount.
	 * @param array $args Optional transaction metadata (user_id, post_id, currency, description).
	 * @return int|\WP_Error Transaction ID or error.
	 */
	public static function create_transaction( $line_items, $args = array() ) {
		// 1. Validate line items.
		$validation = self::validate_line_items( $line_items );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		// Allow filtering of line items before validation.
		$line_items = apply_filters( 'fair_payment_before_validate_line_items', $line_items, $args );

		// 2. Calculate total.
		$total = self::calculate_total( $line_items );

		// Allow filtering of calculated total.
		$total = apply_filters( 'fair_payment_calculated_total', $total, $line_items );

		// 3. Parse arguments.
		$defaults = array(
			'currency'    => 'EUR',
			'description' => '',
			'post_id'     => null,
			'user_id'     => get_current_user_id(),
			'metadata'    => array(),
		);
		$args     = wp_parse_args( $args, $defaults );

		// 4. Prepare transaction data.
		$transaction_data = array(
			'mollie_payment_id' => '', // Empty until payment initiated.
			'post_id'           => $args['post_id'],
			'user_id'           => $args['user_id'],
			'amount'            => $total,
			'currency'          => $args['currency'],
			'status'            => 'draft',
			'description'       => $args['description'],
			'redirect_url'      => '',
			'webhook_url'       => '',
			'checkout_url'      => '',
			'metadata'          => $args['metadata'],
		);

		// Allow filtering of transaction data before creation.
		$transaction_data = apply_filters( 'fair_payment_before_create_transaction', $transaction_data );

		// 5. Create transaction record.
		$transaction_id = Transaction::create( $transaction_data );

		if ( ! $transaction_id ) {
			return new \WP_Error(
				'transaction_creation_failed',
				__( 'Failed to create transaction.', 'fair-payment' )
			);
		}

		// 6. Create line items.
		$line_items_created = LineItem::create_for_transaction( $transaction_id, $line_items );

		if ( ! $line_items_created ) {
			// Rollback: delete transaction.
			global $wpdb;
			$table_name = \FairPayment\Database\Schema::get_payments_table_name();
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->delete( $table_name, array( 'id' => $transaction_id ), array( '%d' ) );

			return new \WP_Error(
				'line_items_creation_failed',
				__( 'Failed to create line items.', 'fair-payment' )
			);
		}

		// 7. Fire action hook.
		do_action( 'fair_payment_transaction_created', $transaction_id, $line_items, $args );

		return $transaction_id;
	}

	/**
	 * Initiate payment for a transaction
	 *
	 * @param int   $transaction_id Transaction ID.
	 * @param array $args Payment arguments (redirect_url, webhook_url).
	 * @return array|\WP_Error Payment data (checkout_url, mollie_payment_id, status) or error.
	 */
	public static function initiate_payment( $transaction_id, $args = array() ) {
		// 1. Get transaction.
		$transaction = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return new \WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-payment' )
			);
		}

		// 2. Check if can initiate payment.
		$can_initiate = Transaction::can_initiate_payment( $transaction_id );
		if ( is_wp_error( $can_initiate ) ) {
			return $can_initiate;
		}

		// 3. Validate arguments.
		if ( empty( $args['redirect_url'] ) ) {
			return new \WP_Error(
				'missing_redirect_url',
				__( 'Redirect URL is required.', 'fair-payment' )
			);
		}

		// 4. Prepare payment arguments.
		$payment_args = array(
			'amount'          => $transaction->amount,
			'currency'        => $transaction->currency,
			'application_fee' => $transaction->application_fee,
			'description'     => ! empty( $transaction->description )
				? $transaction->description
				: sprintf(
					/* translators: %d: transaction ID */
					__( 'Payment #%d', 'fair-payment' ),
					$transaction_id
				),
			'redirect_url'    => $args['redirect_url'],
			'webhook_url'     => isset( $args['webhook_url'] )
				? $args['webhook_url']
				: rest_url( 'fair-payment/v1/webhook' ),
			'metadata'        => array_merge(
				! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array(),
				array( 'transaction_id' => $transaction_id )
			),
		);

		// Allow filtering of payment arguments before Mollie call.
		$payment_args = apply_filters( 'fair_payment_before_initiate_payment', $payment_args, $transaction );

		// 5. Create Mollie payment.
		try {
			$handler        = new MolliePaymentHandler();
			$mollie_payment = $handler->create_payment( $payment_args );
		} catch ( \Exception $e ) {
			return new \WP_Error(
				'mollie_payment_failed',
				$e->getMessage()
			);
		}

		// 6. Update transaction.
		$updated = Transaction::mark_payment_initiated(
			$transaction_id,
			$mollie_payment['mollie_payment_id'],
			$mollie_payment['checkout_url']
		);

		if ( ! $updated ) {
			return new \WP_Error(
				'transaction_update_failed',
				__( 'Failed to update transaction with payment details.', 'fair-payment' )
			);
		}

		// 7. Fire action hook.
		do_action( 'fair_payment_payment_initiated', $transaction_id, $mollie_payment );

		// 8. Return payment data.
		return array(
			'checkout_url'      => $mollie_payment['checkout_url'],
			'mollie_payment_id' => $mollie_payment['mollie_payment_id'],
			'status'            => $mollie_payment['status'],
		);
	}

	/**
	 * Get transaction by ID with line items
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object|null Transaction object with line_items property, or null if not found.
	 */
	public static function get_transaction( $transaction_id ) {
		$transaction = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return null;
		}

		// Get line items.
		$transaction->line_items = LineItem::get_by_transaction_id( $transaction_id );

		// Fire action hook.
		do_action( 'fair_payment_transaction_retrieved', $transaction );

		return $transaction;
	}

	/**
	 * Handle payment status change actions
	 *
	 * Fires the appropriate action hooks based on the payment status.
	 * Shared between webhook handler and sync method.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 * @return void
	 */
	public static function handle_payment_status_change( $payment, $transaction ) {
		switch ( $payment->status ) {
			case 'paid':
				self::capture_mollie_fee( $payment, $transaction );
				do_action( 'fair_payment_paid', $payment, $transaction );
				break;

			case 'failed':
			case 'canceled':
			case 'expired':
				do_action( 'fair_payment_failed', $payment, $transaction );
				break;

			case 'authorized':
				do_action( 'fair_payment_authorized', $payment, $transaction );
				break;
		}

		do_action( 'fair_payment_status_changed', $payment, $transaction );
	}

	/**
	 * Sync transaction status with Mollie
	 *
	 * Proactively checks Mollie API for the real status of a pending_payment transaction.
	 * If the status has changed, updates the DB and fires action hooks.
	 *
	 * @param int  $transaction_id Transaction ID.
	 * @param bool $force Force Mollie API call even when heuristics say it is not needed.
	 * @return object|\WP_Error|null Updated transaction object, WP_Error on forced-sync failure, or null if not found.
	 */
	public static function sync_transaction_status( $transaction_id, $force = false ) {
		$transaction = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return null;
		}

		// Only sync if we have a Mollie payment ID.
		if ( empty( $transaction->mollie_payment_id ) ) {
			if ( $force ) {
				return new \WP_Error(
					'no_mollie_payment_id',
					__( 'This transaction has no Mollie payment ID to sync.', 'fair-payment' )
				);
			}
			return $transaction;
		}

		// Determine if we need to call Mollie API.
		$needs_status_sync = 'pending_payment' === $transaction->status;
		$needs_fee_sync    = 'paid' === $transaction->status && null === $transaction->mollie_fee;

		if ( ! $force && ! $needs_status_sync && ! $needs_fee_sync ) {
			return $transaction;
		}

		try {
			$handler = new MolliePaymentHandler();
			$options = array(
				'testmode' => ! empty( $transaction->testmode ),
			);
			$payment = $handler->get_payment( $transaction->mollie_payment_id, $options );

			// If Mollie status differs from our stored status, update.
			if ( $payment->status !== $transaction->status ) {
				Transaction::update_status( $transaction->mollie_payment_id, $payment->status );
				self::handle_payment_status_change( $payment, $transaction );

				// Return fresh transaction from DB.
				$updated             = Transaction::get_by_id( $transaction_id );
				$updated->sync_debug = self::build_mollie_debug( $payment );
				return $updated;
			}

			// Capture Mollie fee whenever settlement data is available (covers forced syncs too).
			if ( 'paid' === $payment->status ) {
				self::capture_mollie_fee( $payment, $transaction );
				$updated             = Transaction::get_by_id( $transaction_id );
				$updated->sync_debug = self::build_mollie_debug( $payment );
				return $updated;
			}

			$transaction->sync_debug = self::build_mollie_debug( $payment );
		} catch ( \Exception $e ) {
			// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			error_log( 'Fair Payment sync error: ' . $e->getMessage() );

			if ( $force ) {
				return new \WP_Error(
					'mollie_sync_failed',
					$e->getMessage()
				);
			}
		}

		return $transaction;
	}

	/**
	 * Build a snapshot of the Mollie fields we rely on for diagnostics.
	 *
	 * @param object $payment Mollie payment object.
	 * @return array
	 */
	private static function build_mollie_debug( $payment ) {
		$to_amount = static function ( $field ) {
			if ( empty( $field ) || ! isset( $field->value ) ) {
				return null;
			}
			return array(
				'value'    => $field->value,
				'currency' => $field->currency ?? null,
			);
		};

		return array(
			'status'            => $payment->status ?? null,
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'settlement_id'     => $payment->settlementId ?? null,
			'amount'            => $to_amount( $payment->amount ?? null ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'settlement_amount' => $to_amount( $payment->settlementAmount ?? null ),
			'application_fee'   => isset( $payment->applicationFee->amount )
				? $to_amount( $payment->applicationFee->amount )
				: null,
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'amount_remaining'  => $to_amount( $payment->amountRemaining ?? null ),
			// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
			'amount_refunded'   => $to_amount( $payment->amountRefunded ?? null ),
		);
	}

	/**
	 * Capture Mollie processing fee from a paid payment
	 *
	 * Calculates the Mollie fee as: amount - settlementAmount - application_fee.
	 * Only stores the fee if settlementAmount is available and the calculated fee is non-negative.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 * @return void
	 */
	private static function capture_mollie_fee( $payment, $transaction ) {
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API property name.
		if ( empty( $payment->settlementAmount ) ) {
			return;
		}

		$amount = (float) $payment->amount->value;
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API property name.
		$settlement_amount = (float) $payment->settlementAmount->value;
		$application_fee   = (float) ( $transaction->application_fee ?? 0 );

		$mollie_fee = round( $amount - $settlement_amount - $application_fee, 2 );

		if ( $mollie_fee >= 0 ) {
			Transaction::update_mollie_fee( $transaction->mollie_payment_id, $mollie_fee );
		}
	}

	/**
	 * Validate line items structure
	 *
	 * @param array $line_items Array of line items.
	 * @return true|\WP_Error True on success or error.
	 */
	private static function validate_line_items( $line_items ) {
		// Must be array.
		if ( ! is_array( $line_items ) ) {
			return new \WP_Error(
				'invalid_line_items',
				__( 'Line items must be an array.', 'fair-payment' )
			);
		}

		// Must have at least one item.
		if ( empty( $line_items ) ) {
			return new \WP_Error(
				'empty_line_items',
				__( 'At least one line item is required.', 'fair-payment' )
			);
		}

		// Validate each item.
		foreach ( $line_items as $index => $item ) {
			// Must be array.
			if ( ! is_array( $item ) ) {
				return new \WP_Error(
					'invalid_line_item',
					sprintf(
						/* translators: %d: line item index */
						__( 'Line item at index %d must be an array.', 'fair-payment' ),
						$index
					)
				);
			}

			// Required: name.
			if ( empty( $item['name'] ) ) {
				return new \WP_Error(
					'missing_line_item_name',
					sprintf(
						/* translators: %d: line item index */
						__( 'Line item at index %d is missing required "name" field.', 'fair-payment' ),
						$index
					)
				);
			}

			// Required: amount.
			if ( ! isset( $item['amount'] ) || ! is_numeric( $item['amount'] ) ) {
				return new \WP_Error(
					'invalid_line_item_amount',
					sprintf(
						/* translators: %d: line item index */
						__( 'Line item at index %d has invalid "amount" field.', 'fair-payment' ),
						$index
					)
				);
			}

			// Amount must be positive.
			if ( $item['amount'] <= 0 ) {
				return new \WP_Error(
					'negative_line_item_amount',
					sprintf(
						/* translators: %d: line item index */
						__( 'Line item at index %d must have positive amount.', 'fair-payment' ),
						$index
					)
				);
			}

			// Optional: quantity (default 1).
			if ( isset( $item['quantity'] ) ) {
				$quantity = (int) $item['quantity'];
				if ( $quantity <= 0 ) {
					return new \WP_Error(
						'invalid_line_item_quantity',
						sprintf(
							/* translators: %d: line item index */
							__( 'Line item at index %d must have positive quantity.', 'fair-payment' ),
							$index
						)
					);
				}
			}
		}

		return true;
	}

	/**
	 * Calculate total from line items
	 *
	 * @param array $line_items Array of line items.
	 * @return float Total amount.
	 */
	private static function calculate_total( $line_items ) {
		$total = 0;

		foreach ( $line_items as $item ) {
			$quantity = isset( $item['quantity'] ) ? (int) $item['quantity'] : 1;
			$amount   = (float) $item['amount'];
			$total   += $quantity * $amount;
		}

		return round( $total, 2 );
	}
}
