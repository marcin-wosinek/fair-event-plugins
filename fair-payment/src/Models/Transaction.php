<?php
/**
 * Transaction Model
 *
 * @package FairPayment
 */

namespace FairPayment\Models;

defined( 'WPINC' ) || die;

/**
 * Model class for payment transactions
 */
class Transaction {
	/**
	 * Create a new transaction record
	 *
	 * @param array $data Transaction data.
	 * @return int|false Transaction ID or false on failure.
	 */
	public static function create( $data ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		// Determine testmode from current settings.
		$mode     = get_option( 'fair_payment_mode', 'test' );
		$testmode = ( 'live' === $mode ) ? 0 : 1;

		$defaults = array(
			'mollie_payment_id' => '',
			'post_id'           => null,
			'user_id'           => get_current_user_id(),
			'amount'            => 0,
			'currency'          => 'EUR',
			'status'            => 'draft',
			'testmode'          => $testmode,
			'description'       => '',
			'redirect_url'      => '',
			'webhook_url'       => '',
			'checkout_url'      => '',
			'metadata'          => '',
		);

		$data = wp_parse_args( $data, $defaults );

		// Calculate application fee (2% of transaction amount).
		$application_fee = null;
		if ( $data['amount'] > 0 ) {
			$application_fee = round( $data['amount'] * 0.02, 2 );
		}

		$data['application_fee'] = $application_fee;

		// Convert metadata array to JSON if needed.
		if ( is_array( $data['metadata'] ) ) {
			$data['metadata'] = wp_json_encode( $data['metadata'] );
		}

		$inserted = $wpdb->insert(
			$table_name,
			array(
				'mollie_payment_id' => $data['mollie_payment_id'],
				'post_id'           => $data['post_id'],
				'user_id'           => $data['user_id'],
				'amount'            => $data['amount'],
				'currency'          => $data['currency'],
				'application_fee'   => $data['application_fee'],
				'status'            => $data['status'],
				'testmode'          => $data['testmode'],
				'description'       => $data['description'],
				'redirect_url'      => $data['redirect_url'],
				'webhook_url'       => $data['webhook_url'],
				'checkout_url'      => $data['checkout_url'],
				'metadata'          => $data['metadata'],
			),
			array( '%s', '%d', '%d', '%f', '%s', '%f', '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		return $inserted ? $wpdb->insert_id : false;
	}

	/**
	 * Update transaction status
	 *
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @param string $status New status.
	 * @return bool True on success, false on failure.
	 */
	public static function update_status( $mollie_payment_id, $status ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		return (bool) $wpdb->update(
			$table_name,
			array( 'status' => $status ),
			array( 'mollie_payment_id' => $mollie_payment_id ),
			array( '%s' ),
			array( '%s' )
		);
	}

	/**
	 * Get transaction by Mollie payment ID
	 *
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @return object|null Transaction object or null if not found.
	 */
	public static function get_by_mollie_id( $mollie_payment_id ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE mollie_payment_id = %s',
				$table_name,
				$mollie_payment_id
			)
		);
	}

	/**
	 * Get all transactions
	 *
	 * @param array $args Query arguments.
	 * @return array Array of transaction objects.
	 */
	public static function get_all( $args = array() ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		$defaults = array(
			'limit'  => 50,
			'offset' => 0,
			'status' => '',
		);

		$args = wp_parse_args( $args, $defaults );

		$where = '';
		if ( ! empty( $args['status'] ) ) {
			$where = $wpdb->prepare( ' WHERE status = %s', $args['status'] );
		}

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i{$where} ORDER BY created_at DESC LIMIT %d OFFSET %d",
				$table_name,
				$args['limit'],
				$args['offset']
			)
		);
	}

	/**
	 * Get transaction by ID
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object|null Transaction object or null if not found.
	 */
	public static function get_by_id( $transaction_id ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d',
				$table_name,
				$transaction_id
			)
		);
	}

	/**
	 * Mark transaction as payment initiated
	 *
	 * @param int    $transaction_id Transaction ID.
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @param string $checkout_url Mollie checkout URL.
	 * @return bool True on success, false on failure.
	 */
	public static function mark_payment_initiated( $transaction_id, $mollie_payment_id, $checkout_url ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		return (bool) $wpdb->update(
			$table_name,
			array(
				'mollie_payment_id'    => $mollie_payment_id,
				'checkout_url'         => $checkout_url,
				'status'               => 'pending_payment',
				'payment_initiated_at' => current_time( 'mysql' ),
			),
			array( 'id' => $transaction_id ),
			array( '%s', '%s', '%s', '%s' ),
			array( '%d' )
		);
	}

	/**
	 * Check if transaction can initiate payment
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return true|\WP_Error True if can initiate, WP_Error otherwise.
	 */
	public static function can_initiate_payment( $transaction_id ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		$transaction = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT status, payment_initiated_at FROM %i WHERE id = %d',
				$table_name,
				$transaction_id
			)
		);

		if ( ! $transaction ) {
			return new \WP_Error(
				'transaction_not_found',
				__( 'Transaction not found.', 'fair-payment' )
			);
		}

		// Check if already initiated.
		if ( null !== $transaction->payment_initiated_at ) {
			return new \WP_Error(
				'payment_already_initiated',
				__( 'Payment has already been initiated for this transaction. Create a new transaction to retry.', 'fair-payment' )
			);
		}

		// Check status.
		if ( 'draft' !== $transaction->status ) {
			return new \WP_Error(
				'invalid_transaction_status',
				sprintf(
					/* translators: %s: current transaction status */
					__( 'Transaction status must be "draft" to initiate payment. Current status: %s', 'fair-payment' ),
					$transaction->status
				)
			);
		}

		return true;
	}
}
