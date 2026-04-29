<?php
/**
 * REST API Controller for Transactions
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

use FairPayment\Models\Transaction;
use FairPayment\Models\LineItem;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

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

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id'             => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'participant_id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'user_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'post_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'transactions' => array(
							'type'     => 'array',
							'required' => true,
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)/sync-mollie',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'sync_mollie' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
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
			'limit'         => $per_page,
			'offset'        => $offset,
			'status'        => $request->get_param( 'status' ) ?? '',
			'mode'          => $request->get_param( 'mode' ) ?? '',
			'event_date_id' => $request->get_param( 'event_date_id' ) ?? 0,
			'orderby'       => $request->get_param( 'orderby' ) ?? 'created_at',
			'order'         => $request->get_param( 'order' ) ?? 'DESC',
		);

		$transactions = Transaction::get_all( $query_args );
		$total        = Transaction::count(
			array(
				'status'        => $query_args['status'],
				'mode'          => $query_args['mode'],
				'event_date_id' => $query_args['event_date_id'],
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

			$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
				? (int) $transaction->participant_id
				: null;
			$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

			$data[] = array(
				'id'                => (int) $transaction->id,
				'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
				'event_date_id'     => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
				'amount'            => (float) ( $transaction->amount ?? 0 ),
				'currency'          => $transaction->currency ?? 'EUR',
				'mollie_fee'        => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
				'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
				'status'            => $transaction->status ?? 'unknown',
				'testmode'          => ! empty( $transaction->testmode ),
				'description'       => $transaction->description ?? '',
				'user_name'         => $user_name,
				'participant_id'    => $participant_id,
				'participant'       => $participant,
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
	 * Get a single transaction
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		// Sync with Mollie to capture missing fee or update pending status.
		$transaction = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Update editable fields on a transaction.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$transaction = Transaction::get_by_id( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		$fields = array();

		if ( null !== $request->get_param( 'participant_id' ) ) {
			$fields['participant_id'] = $request->get_param( 'participant_id' ) ?: null;
		}

		if ( null !== $request->get_param( 'user_id' ) ) {
			$fields['user_id'] = $request->get_param( 'user_id' ) ?: null;
		}

		if ( null !== $request->get_param( 'post_id' ) ) {
			$fields['post_id'] = $request->get_param( 'post_id' ) ?: null;
		}

		if ( empty( $fields ) ) {
			return new WP_Error(
				'no_fields',
				__( 'No fields to update.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$updated = Transaction::update_fields( (int) $transaction->id, $fields );

		if ( ! $updated ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update transaction.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$transaction = Transaction::get_by_id( (int) $transaction->id );

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Import transactions from an exported JSON payload.
	 *
	 * Creates new rows or updates existing ones matched by mollie_payment_id.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_items( $request ) {
		$transactions = $request->get_param( 'transactions' );

		if ( ! is_array( $transactions ) ) {
			return new WP_Error(
				'invalid_payload',
				__( 'Expected an array of transactions.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$created = 0;
		$updated = 0;
		$skipped = 0;

		foreach ( $transactions as $transaction ) {
			if ( ! is_array( $transaction ) ) {
				++$skipped;
				continue;
			}

			$result = Transaction::import( $transaction );

			if ( 'created' === $result ) {
				++$created;
			} elseif ( 'updated' === $result ) {
				++$updated;
			} else {
				++$skipped;
			}
		}

		return new WP_REST_Response(
			array(
				'created' => $created,
				'updated' => $updated,
				'skipped' => $skipped,
				'message' => sprintf(
					/* translators: 1: created count, 2: updated count, 3: skipped count */
					__( 'Imported %1$d new, updated %2$d, skipped %3$d transaction(s).', 'fair-payment' ),
					$created,
					$updated,
					$skipped
				),
			),
			200
		);
	}

	/**
	 * Force a Mollie sync for a transaction to refresh status and fee data.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function sync_mollie( $request ) {
		$result = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ), true );

		if ( null === $result ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		if ( is_wp_error( $result ) ) {
			$result->add_data( array( 'status' => 400 ) );
			return $result;
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $result ), 200 );
	}

	/**
	 * Build the REST response payload for a transaction row.
	 *
	 * @param object $transaction Transaction record from the DB.
	 * @return array
	 */
	private function prepare_transaction_response( $transaction ) {
		$user_name = '';
		if ( $transaction->user_id ) {
			$user = get_userdata( $transaction->user_id );
			if ( $user ) {
				$user_name = $user->display_name;
			}
		}

		$post_title = '';
		if ( $transaction->post_id ) {
			$post = get_post( $transaction->post_id );
			if ( $post ) {
				$post_title = $post->post_title;
			}
		}

		$metadata = $transaction->metadata ?? '';
		if ( is_string( $metadata ) && '' !== $metadata ) {
			$decoded  = json_decode( $metadata );
			$metadata = ( null !== $decoded ) ? $decoded : $metadata;
		}

		$line_items     = LineItem::get_by_transaction_id( $transaction->id );
		$line_item_data = array();
		foreach ( $line_items as $item ) {
			$line_item_data[] = array(
				'id'           => (int) $item->id,
				'name'         => $item->name,
				'description'  => $item->description ?? '',
				'quantity'     => (int) $item->quantity,
				'unit_amount'  => (float) $item->unit_amount,
				'total_amount' => (float) $item->total_amount,
			);
		}

		$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
			? (int) $transaction->participant_id
			: null;
		$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

		$data = array(
			'id'                   => (int) $transaction->id,
			'mollie_payment_id'    => $transaction->mollie_payment_id ?? '',
			'post_id'              => $transaction->post_id ? (int) $transaction->post_id : null,
			'event_date_id'        => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
			'post_title'           => $post_title,
			'user_id'              => $transaction->user_id ? (int) $transaction->user_id : null,
			'user_name'            => $user_name,
			'participant_id'       => $participant_id,
			'participant'          => $participant,
			'amount'               => (float) ( $transaction->amount ?? 0 ),
			'currency'             => $transaction->currency ?? 'EUR',
			'mollie_fee'           => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
			'application_fee'      => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
			'status'               => $transaction->status ?? 'unknown',
			'testmode'             => ! empty( $transaction->testmode ),
			'description'          => $transaction->description ?? '',
			'redirect_url'         => $transaction->redirect_url ?? '',
			'webhook_url'          => $transaction->webhook_url ?? '',
			'checkout_url'         => $transaction->checkout_url ?? '',
			'metadata'             => $metadata,
			'created_at'           => $transaction->created_at ?? '',
			'payment_initiated_at' => $transaction->payment_initiated_at ?? '',
			'updated_at'           => $transaction->updated_at ?? '',
			'line_items'           => $line_item_data,
		);

		if ( isset( $transaction->sync_debug ) ) {
			$data['sync_debug'] = $transaction->sync_debug;
		}

		return $data;
	}

	/**
	 * Get collection parameters
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'          => array(
				'type'              => 'integer',
				'default'           => 1,
				'minimum'           => 1,
				'sanitize_callback' => 'absint',
			),
			'per_page'      => array(
				'type'              => 'integer',
				'default'           => 50,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
			),
			'status'        => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'mode'          => array(
				'type'              => 'string',
				'default'           => '',
				'enum'              => array( '', 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'event_date_id' => array(
				'type'              => 'integer',
				'default'           => 0,
				'minimum'           => 0,
				'sanitize_callback' => 'absint',
			),
			'orderby'       => array(
				'type'              => 'string',
				'default'           => 'created_at',
				'enum'              => array( 'created_at', 'amount', 'status', 'id' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'order'         => array(
				'type'              => 'string',
				'default'           => 'DESC',
				'enum'              => array( 'ASC', 'DESC' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}
}
