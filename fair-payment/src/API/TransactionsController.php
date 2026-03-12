<?php
/**
 * REST API Controller for Transactions
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

use FairPayment\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Handles transaction REST API endpoints
 */
class TransactionsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payment/v1';

	/**
	 * Register the routes for transactions
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get a collection of transactions
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$per_page = $request->get_param( 'per_page' ) ?? 50;
		$page     = $request->get_param( 'page' ) ?? 1;
		$offset   = ( $page - 1 ) * $per_page;

		$query_args = array(
			'limit'   => $per_page,
			'offset'  => $offset,
			'status'  => $request->get_param( 'status' ) ?? '',
			'mode'    => $request->get_param( 'mode' ) ?? '',
			'orderby' => $request->get_param( 'orderby' ) ?? 'created_at',
			'order'   => $request->get_param( 'order' ) ?? 'DESC',
		);

		$transactions = Transaction::get_all( $query_args );
		$total        = Transaction::count(
			array(
				'status' => $query_args['status'],
				'mode'   => $query_args['mode'],
			)
		);

		$data = array();
		foreach ( $transactions as $transaction ) {
			$user_name = '';
			if ( $transaction->user_id ) {
				$user = get_userdata( $transaction->user_id );
				if ( $user ) {
					$user_name = $user->display_name;
				}
			}

			$data[] = array(
				'id'                => (int) $transaction->id,
				'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
				'amount'            => (float) ( $transaction->amount ?? 0 ),
				'currency'          => $transaction->currency ?? 'EUR',
				'mollie_fee'        => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
				'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
				'status'            => $transaction->status ?? 'unknown',
				'testmode'          => ! empty( $transaction->testmode ),
				'description'       => $transaction->description ?? '',
				'user_name'         => $user_name,
				'created_at'        => $transaction->created_at ?? '',
			);
		}

		return new WP_REST_Response(
			array(
				'transactions' => $data,
				'total'        => $total,
				'pages'        => ceil( $total / $per_page ),
				'page'         => (int) $page,
			),
			200
		);
	}

	/**
	 * Get collection parameters
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'     => array(
				'type'              => 'integer',
				'default'           => 1,
				'minimum'           => 1,
				'sanitize_callback' => 'absint',
			),
			'per_page' => array(
				'type'              => 'integer',
				'default'           => 50,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
			),
			'status'   => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'mode'     => array(
				'type'              => 'string',
				'default'           => '',
				'enum'              => array( '', 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'orderby'  => array(
				'type'              => 'string',
				'default'           => 'created_at',
				'enum'              => array( 'created_at', 'amount', 'status', 'id' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'order'    => array(
				'type'              => 'string',
				'default'           => 'DESC',
				'enum'              => array( 'ASC', 'DESC' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}
}
