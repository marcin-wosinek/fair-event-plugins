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

			$participant_name = $this->get_participant_name( $transaction->user_id );

			$post_title    = '';
			$post_edit_url = '';
			if ( $transaction->post_id ) {
				$post = get_post( $transaction->post_id );
				if ( $post ) {
					$post_title    = $post->post_title ?: __( '(no name)', 'fair-payment' );
					$post_edit_url = get_edit_post_link( $post->ID, 'raw' );
				}
			}

			$line_items         = LineItem::get_by_transaction_id( $transaction->id );
			$line_items_summary = $this->format_line_items_summary( $line_items );

			$data[] = array(
				'id'                 => (int) $transaction->id,
				'mollie_payment_id'  => $transaction->mollie_payment_id ?? '',
				'amount'             => (float) ( $transaction->amount ?? 0 ),
				'currency'           => $transaction->currency ?? 'EUR',
				'mollie_fee'         => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
				'application_fee'    => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
				'status'             => $transaction->status ?? 'unknown',
				'testmode'           => ! empty( $transaction->testmode ),
				'description'        => $transaction->description ?? '',
				'user_name'          => $user_name,
				'participant_name'   => $participant_name,
				'post_title'         => $post_title,
				'post_edit_url'      => $post_edit_url,
				'line_items_summary' => $line_items_summary,
				'created_at'         => $transaction->created_at ?? '',
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
	 * Get participant name for a WordPress user ID
	 *
	 * @param int|null $user_id WordPress user ID.
	 * @return string Participant name or empty string.
	 */
	private function get_participant_name( $user_id ) {
		if ( ! $user_id ) {
			return '';
		}

		if ( ! class_exists( '\FairAudience\Database\ParticipantRepository' ) ) {
			return '';
		}

		$repository  = new \FairAudience\Database\ParticipantRepository();
		$participant = $repository->get_by_user_id( $user_id );

		if ( ! $participant ) {
			return '';
		}

		return trim( $participant->name . ' ' . $participant->surname );
	}

	/**
	 * Format line items into a summary string
	 *
	 * @param array $line_items Array of line item objects.
	 * @return string Summary like "2x Workshop ticket, 1x T-shirt".
	 */
	private function format_line_items_summary( $line_items ) {
		if ( empty( $line_items ) ) {
			return '';
		}

		$parts = array();
		foreach ( $line_items as $item ) {
			$qty     = (int) $item->quantity;
			$parts[] = $qty . "\u{00d7} " . $item->name;
		}

		return implode( ', ', $parts );
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
