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
			'event_date_id'     => null,
			'user_id'           => get_current_user_id(),
			'participant_id'    => null,
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
				'event_date_id'     => $data['event_date_id'],
				'user_id'           => $data['user_id'],
				'participant_id'    => $data['participant_id'],
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
			array( '%s', '%d', '%d', '%d', '%d', '%f', '%s', '%f', '%s', '%d', '%s', '%s', '%s', '%s', '%s' )
		);

		return $inserted ? $wpdb->insert_id : false;
	}

	/**
	 * Import a transaction from an external source.
	 *
	 * Creates a new transaction record or updates an existing one matched by
	 * mollie_payment_id. Preserves fees, status, mode, description and the
	 * original created_at timestamp so the source and target sites stay in sync.
	 *
	 * @param array $data Transaction data from an export file.
	 * @return string 'created', 'updated', or 'skipped'.
	 */
	public static function import( $data ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		$mollie_payment_id = isset( $data['mollie_payment_id'] ) ? (string) $data['mollie_payment_id'] : '';

		if ( '' === $mollie_payment_id ) {
			return 'skipped';
		}

		$metadata = array();
		if ( ! empty( $data['source_domain'] ) ) {
			$metadata['source_domain'] = (string) $data['source_domain'];
		}
		if ( ! empty( $data['detail_url'] ) ) {
			$metadata['detail_url'] = (string) $data['detail_url'];
		}

		$row = array(
			'amount'          => isset( $data['amount'] ) ? (float) $data['amount'] : 0,
			'currency'        => ! empty( $data['currency'] ) ? (string) $data['currency'] : 'EUR',
			'mollie_fee'      => isset( $data['mollie_fee'] ) && null !== $data['mollie_fee'] ? (float) $data['mollie_fee'] : null,
			'application_fee' => isset( $data['application_fee'] ) && null !== $data['application_fee'] ? (float) $data['application_fee'] : null,
			'status'          => ! empty( $data['status'] ) ? (string) $data['status'] : 'paid',
			'testmode'        => ! empty( $data['testmode'] ) ? 1 : 0,
			'description'     => isset( $data['description'] ) ? (string) $data['description'] : '',
			'metadata'        => wp_json_encode( $metadata ),
		);

		$existing = self::get_by_mollie_id( $mollie_payment_id );

		if ( $existing ) {
			$wpdb->update(
				$table_name,
				$row,
				array( 'mollie_payment_id' => $mollie_payment_id ),
				array( '%f', '%s', '%f', '%f', '%s', '%d', '%s', '%s' ),
				array( '%s' )
			);
			return 'updated';
		}

		$row['mollie_payment_id'] = $mollie_payment_id;

		$formats = array( '%f', '%s', '%f', '%f', '%s', '%d', '%s', '%s', '%s' );

		if ( ! empty( $data['created_at'] ) ) {
			$row['created_at'] = (string) $data['created_at'];
			$formats[]         = '%s';
		}

		$inserted = $wpdb->insert( $table_name, $row, $formats );

		return $inserted ? 'created' : 'skipped';
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
	 * Update Mollie processing fee for a transaction
	 *
	 * @param string $mollie_payment_id Mollie payment ID.
	 * @param float  $mollie_fee Mollie processing fee amount.
	 * @return bool True on success, false on failure.
	 */
	public static function update_mollie_fee( $mollie_payment_id, $mollie_fee ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		return (bool) $wpdb->update(
			$table_name,
			array( 'mollie_fee' => $mollie_fee ),
			array( 'mollie_payment_id' => $mollie_payment_id ),
			array( '%f' ),
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
			'limit'         => 50,
			'offset'        => 0,
			'status'        => '',
			'mode'          => '',
			'event_date_id' => 0,
			'orderby'       => 'created_at',
			'order'         => 'DESC',
		);

		$args = wp_parse_args( $args, $defaults );

		$where_clauses = array();

		if ( ! empty( $args['status'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'status = %s', $args['status'] );
		}

		if ( '' !== $args['mode'] ) {
			$testmode        = 'test' === $args['mode'] ? 1 : 0;
			$where_clauses[] = $wpdb->prepare( 'testmode = %d', $testmode );
		}

		if ( ! empty( $args['event_date_id'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'event_date_id = %d', (int) $args['event_date_id'] );
		}

		$where = '';
		if ( ! empty( $where_clauses ) ) {
			$where = ' WHERE ' . implode( ' AND ', $where_clauses );
		}

		$allowed_orderby = array( 'created_at', 'amount', 'status', 'id' );
		$orderby         = in_array( $args['orderby'], $allowed_orderby, true ) ? $args['orderby'] : 'created_at';
		$order           = 'ASC' === strtoupper( $args['order'] ) ? 'ASC' : 'DESC';

		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i{$where} ORDER BY {$orderby} {$order} LIMIT %d OFFSET %d",
				$table_name,
				$args['limit'],
				$args['offset']
			)
		);
	}

	/**
	 * Count transactions with optional filters
	 *
	 * @param array $args Query arguments.
	 * @return int Total count.
	 */
	public static function count( $args = array() ) {
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();

		$where_clauses = array();

		if ( ! empty( $args['status'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'status = %s', $args['status'] );
		}

		if ( isset( $args['mode'] ) && '' !== $args['mode'] ) {
			$testmode        = 'test' === $args['mode'] ? 1 : 0;
			$where_clauses[] = $wpdb->prepare( 'testmode = %d', $testmode );
		}

		if ( ! empty( $args['event_date_id'] ) ) {
			$where_clauses[] = $wpdb->prepare( 'event_date_id = %d', (int) $args['event_date_id'] );
		}

		$where = '';
		if ( ! empty( $where_clauses ) ) {
			$where = ' WHERE ' . implode( ' AND ', $where_clauses );
		}

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM %i{$where}",
				$table_name
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
