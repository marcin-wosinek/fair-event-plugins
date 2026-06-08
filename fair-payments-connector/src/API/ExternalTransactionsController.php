<?php
/**
 * Public external REST API controller for transactions.
 *
 * Read-only, token-authenticated endpoint exposing transaction data to
 * authorized consumer sites (data sharing API).
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Handles the public GET /external/transactions endpoint.
 */
class ExternalTransactionsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Maximum number of items per page.
	 *
	 * @var int
	 */
	const MAX_PER_PAGE = 200;

	/**
	 * Register the routes for external transactions.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/external/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => ApiTokenAuth::require_scope( 'transactions:read' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);
	}

	/**
	 * Collection parameters for the external transactions endpoint.
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
				'maximum'           => self::MAX_PER_PAGE,
				'sanitize_callback' => 'absint',
			),
			'status'   => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'from'     => array(
				'type'              => 'string',
				'default'           => '',
				'description'       => __( 'Filter by transaction date (created_at) from this date, e.g. 2026-01-01.', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => array( $this, 'validate_date' ),
			),
			'to'       => array(
				'type'              => 'string',
				'default'           => '',
				'description'       => __( 'Filter by transaction date (created_at) up to this date, e.g. 2026-12-31.', 'fair-payments-connector' ),
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => array( $this, 'validate_date' ),
			),
		);
	}

	/**
	 * Validate an ISO date / datetime query parameter.
	 *
	 * @param string $value Value to validate.
	 * @return bool True when empty or a parseable date.
	 */
	public function validate_date( $value ) {
		if ( '' === $value || null === $value ) {
			return true;
		}

		return false !== strtotime( $value );
	}

	/**
	 * Get a collection of transactions.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$per_page = (int) $request->get_param( 'per_page' );
		$page     = (int) $request->get_param( 'page' );

		if ( $per_page < 1 ) {
			$per_page = 50;
		}
		$per_page = min( $per_page, self::MAX_PER_PAGE );
		$page     = max( $page, 1 );
		$offset   = ( $page - 1 ) * $per_page;

		$status = (string) $request->get_param( 'status' );
		$from   = (string) $request->get_param( 'from' );
		$to     = (string) $request->get_param( 'to' );

		$query_args = array(
			'limit'     => $per_page,
			'offset'    => $offset,
			'status'    => $status,
			'date_from' => $from,
			'date_to'   => $to,
			'orderby'   => 'created_at',
			'order'     => 'DESC',
		);

		$transactions = Transaction::get_all( $query_args );
		$total        = Transaction::count(
			array(
				'status'    => $status,
				'date_from' => $from,
				'date_to'   => $to,
			)
		);

		$data = array();
		foreach ( $transactions as $transaction ) {
			$data[] = $this->prepare_transaction( $transaction );
		}

		return new WP_REST_Response(
			array(
				'transactions' => $data,
				'total'        => $total,
				'page'         => $page,
				'per_page'     => $per_page,
			),
			200
		);
	}

	/**
	 * Shape a transaction row for the external response.
	 *
	 * Deliberately excludes user_name and participant details (PII). Includes
	 * description and mollie_payment_id for reconciliation.
	 *
	 * @param object $transaction Transaction row.
	 * @return array
	 */
	private function prepare_transaction( $transaction ) {
		$event_date_id = $transaction->event_date_id ? (int) $transaction->event_date_id : null;
		$event_url     = '';

		if ( $event_date_id && class_exists( '\\FairEvents\\Models\\EventDates' ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
			if ( $event_date && ! empty( $event_date->event_id ) ) {
				$permalink = get_permalink( (int) $event_date->event_id );
				if ( $permalink ) {
					$event_url = $permalink;
				}
			}
		}

		return array(
			'id'                => (int) $transaction->id,
			'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
			'amount'            => (float) ( $transaction->amount ?? 0 ),
			'currency'          => $transaction->currency ?? 'EUR',
			'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
			'status'            => $transaction->status ?? 'unknown',
			'testmode'          => ! empty( $transaction->testmode ),
			'description'       => $transaction->description ?? '',
			'event_date_id'     => $event_date_id,
			'event_url'         => $event_url,
			'created_at'        => $transaction->created_at ?? '',
		);
	}
}
