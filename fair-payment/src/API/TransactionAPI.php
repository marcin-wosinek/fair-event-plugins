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
			'amount'       => $transaction->amount,
			'currency'     => $transaction->currency,
			'description'  => ! empty( $transaction->description )
				? $transaction->description
				: sprintf(
					/* translators: %d: transaction ID */
					__( 'Payment #%d', 'fair-payment' ),
					$transaction_id
				),
			'redirect_url' => $args['redirect_url'],
			'webhook_url'  => isset( $args['webhook_url'] )
				? $args['webhook_url']
				: rest_url( 'fair-payment/v1/webhook' ),
			'metadata'     => array_merge(
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
