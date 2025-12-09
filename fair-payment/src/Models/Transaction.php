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

		$defaults = array(
			'mollie_payment_id' => '',
			'post_id'           => null,
			'user_id'           => get_current_user_id(),
			'amount'            => 0,
			'currency'          => 'EUR',
			'status'            => 'open',
			'description'       => '',
			'redirect_url'      => '',
			'webhook_url'       => '',
			'checkout_url'      => '',
			'metadata'          => '',
		);

		$data = wp_parse_args( $data, $defaults );

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
				'status'            => $data['status'],
				'description'       => $data['description'],
				'redirect_url'      => $data['redirect_url'],
				'webhook_url'       => $data['webhook_url'],
				'checkout_url'      => $data['checkout_url'],
				'metadata'          => $data['metadata'],
			),
			array( '%s', '%d', '%d', '%f', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
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
				"SELECT * FROM $table_name WHERE mollie_payment_id = %s",
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

		$query = $wpdb->prepare(
			"SELECT * FROM $table_name{$where} ORDER BY created_at DESC LIMIT %d OFFSET %d",
			$args['limit'],
			$args['offset']
		);

		return $wpdb->get_results( $query );
	}
}
