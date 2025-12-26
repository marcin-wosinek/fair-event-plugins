<?php
/**
 * Transactions REST Controller
 *
 * @package FairPayment
 */

namespace FairPayment\API;

use FairPayment\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for transactions
 */
class TransactionsController extends WP_REST_Controller {
	/**
	 * Constructor
	 */
	public function __construct() {
		$this->namespace = 'fair-payment/v1';
		$this->rest_base = 'transactions';
	}

	/**
	 * Register routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
				'schema' => array( $this, 'get_public_item_schema' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Transaction ID', 'fair-payment' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
				'schema' => array( $this, 'get_public_item_schema' ),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return bool|WP_Error True if the request has permission, WP_Error otherwise.
	 */
	public function get_items_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view transactions.', 'fair-payment' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Check permissions for getting a single item
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return bool|WP_Error True if the request has permission, WP_Error otherwise.
	 */
	public function get_item_permissions_check( $request ) {
		return $this->get_items_permissions_check( $request );
	}

	/**
	 * Get a collection of transactions
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$params = $request->get_params();

		// Prepare query args.
		$args = array(
			'limit'  => isset( $params['per_page'] ) ? (int) $params['per_page'] : 20,
			'offset' => isset( $params['page'] ) ? ( (int) $params['page'] - 1 ) * ( isset( $params['per_page'] ) ? (int) $params['per_page'] : 20 ) : 0,
			'status' => isset( $params['status'] ) ? sanitize_text_field( $params['status'] ) : '',
		);

		// Get transactions.
		$transactions = Transaction::get_all( $args );

		// Get total count for pagination.
		global $wpdb;
		$table_name = \FairPayment\Database\Schema::get_payments_table_name();
		$where      = '';
		if ( ! empty( $args['status'] ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$where = $wpdb->prepare( ' WHERE status = %s', $args['status'] );
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$total = (int) $wpdb->get_var(
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->prepare( "SELECT COUNT(*) FROM %i{$where}", $table_name )
		);

		// Prepare response data.
		$data = array();
		foreach ( $transactions as $transaction ) {
			$data[] = $this->prepare_item_for_response( $transaction, $request );
		}

		$response = rest_ensure_response( $data );

		// Add pagination headers.
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', ceil( $total / $args['limit'] ) );

		return $response;
	}

	/**
	 * Get a single transaction
	 *
	 * @param WP_REST_Request $request Full request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$transaction_id = (int) $request['id'];
		$transaction    = Transaction::get_by_id( $transaction_id );

		if ( ! $transaction ) {
			return new WP_Error(
				'rest_transaction_not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response( $this->prepare_item_for_response( $transaction, $request ) );
	}

	/**
	 * Prepare transaction for response
	 *
	 * @param object          $transaction Transaction object from database.
	 * @param WP_REST_Request $request Request object.
	 * @return array Prepared transaction data.
	 */
	protected function prepare_item_for_response( $transaction, $request ) {
		// Get user display name.
		$user_display_name = '-';
		if ( $transaction->user_id ) {
			$user = get_userdata( $transaction->user_id );
			if ( $user ) {
				$user_display_name = $user->display_name;
			}
		}

		// Get organization ID for Mollie URL.
		$organization_id = get_option( 'fair_payment_organization_id', '' );
		$mollie_url      = '';
		if ( ! empty( $transaction->mollie_payment_id ) ) {
			$mollie_url = ! empty( $organization_id )
				? sprintf( 'https://my.mollie.com/dashboard/%s/payments/%s', $organization_id, $transaction->mollie_payment_id )
				: sprintf( 'https://www.mollie.com/dashboard/payments/%s', $transaction->mollie_payment_id );
		}

		return array(
			'id'                   => (int) $transaction->id,
			'mollie_payment_id'    => $transaction->mollie_payment_id ?? '',
			'mollie_url'           => $mollie_url,
			'amount'               => (float) ( $transaction->amount ?? 0 ),
			'currency'             => $transaction->currency ?? 'EUR',
			'status'               => $transaction->status ?? 'unknown',
			'testmode'             => ! empty( $transaction->testmode ),
			'description'          => $transaction->description ?? '',
			'user_id'              => (int) ( $transaction->user_id ?? 0 ),
			'user_display_name'    => $user_display_name,
			'created_at'           => $transaction->created_at ?? '',
			'payment_initiated_at' => $transaction->payment_initiated_at ?? null,
		);
	}

	/**
	 * Get collection parameters
	 *
	 * @return array Collection parameters.
	 */
	public function get_collection_params() {
		return array(
			'page'     => array(
				'description'       => __( 'Current page of the collection.', 'fair-payment' ),
				'type'              => 'integer',
				'default'           => 1,
				'sanitize_callback' => 'absint',
				'validate_callback' => 'rest_validate_request_arg',
				'minimum'           => 1,
			),
			'per_page' => array(
				'description'       => __( 'Maximum number of items per page.', 'fair-payment' ),
				'type'              => 'integer',
				'default'           => 20,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
				'validate_callback' => 'rest_validate_request_arg',
			),
			'status'   => array(
				'description'       => __( 'Filter by transaction status.', 'fair-payment' ),
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => 'rest_validate_request_arg',
			),
		);
	}

	/**
	 * Get public item schema
	 *
	 * @return array Item schema.
	 */
	public function get_public_item_schema() {
		return array(
			'$schema'    => 'http://json-schema.org/draft-04/schema#',
			'title'      => 'transaction',
			'type'       => 'object',
			'properties' => array(
				'id'                   => array(
					'description' => __( 'Transaction ID', 'fair-payment' ),
					'type'        => 'integer',
					'readonly'    => true,
				),
				'mollie_payment_id'    => array(
					'description' => __( 'Mollie payment ID', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'mollie_url'           => array(
					'description' => __( 'Mollie dashboard URL', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'amount'               => array(
					'description' => __( 'Transaction amount', 'fair-payment' ),
					'type'        => 'number',
					'readonly'    => true,
				),
				'currency'             => array(
					'description' => __( 'Currency code', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'status'               => array(
					'description' => __( 'Transaction status', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'testmode'             => array(
					'description' => __( 'Whether transaction is in test mode', 'fair-payment' ),
					'type'        => 'boolean',
					'readonly'    => true,
				),
				'description'          => array(
					'description' => __( 'Transaction description', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'user_id'              => array(
					'description' => __( 'User ID', 'fair-payment' ),
					'type'        => 'integer',
					'readonly'    => true,
				),
				'user_display_name'    => array(
					'description' => __( 'User display name', 'fair-payment' ),
					'type'        => 'string',
					'readonly'    => true,
				),
				'created_at'           => array(
					'description' => __( 'Creation date', 'fair-payment' ),
					'type'        => 'string',
					'format'      => 'date-time',
					'readonly'    => true,
				),
				'payment_initiated_at' => array(
					'description' => __( 'Payment initiation date', 'fair-payment' ),
					'type'        => 'string',
					'format'      => 'date-time',
					'readonly'    => true,
				),
			),
		);
	}
}
