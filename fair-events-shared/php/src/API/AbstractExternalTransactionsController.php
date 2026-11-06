<?php
/**
 * Shared token-authenticated transactions endpoint for data sharing APIs
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Handles the public GET /external/transactions endpoint.
 *
 * A plugin's controller extends this one, sets its REST `$namespace`, names
 * its auth class (a subclass of FairEventsShared\ApiTokens\AbstractApiTokenAuth)
 * and its transaction model, and supplies its own translated
 * parameter descriptions, so each plugin keeps a literal text domain.
 *
 * Plugins bundling different versions of this package can be active
 * together, and either copy may be the one loaded. Keep this class
 * additive: never add an abstract method or change a signature.
 */
abstract class AbstractExternalTransactionsController extends WP_REST_Controller {

	/**
	 * Maximum number of items per page.
	 *
	 * @var int
	 */
	const MAX_PER_PAGE = 200;

	/**
	 * Scope the endpoint requires.
	 */
	const REQUIRED_SCOPE = 'transactions:read';

	/**
	 * Auth class, a subclass of AbstractApiTokenAuth.
	 *
	 * @return string Class name.
	 */
	abstract protected function auth_class();

	/**
	 * Transaction model class, with static get_all( $args ) and count( $args ).
	 *
	 * @return string Class name.
	 */
	abstract protected function transaction_model();

	/**
	 * Description of the `from` parameter.
	 *
	 * @return string
	 */
	abstract protected function from_description();

	/**
	 * Description of the `to` parameter.
	 *
	 * @return string
	 */
	abstract protected function to_description();

	/**
	 * Register the routes for external transactions.
	 *
	 * @return void
	 */
	public function register_routes() {
		$auth = $this->auth_class();

		register_rest_route(
			$this->namespace,
			'/external/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => $auth::require_scope( static::REQUIRED_SCOPE ),
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
				'maximum'           => static::MAX_PER_PAGE,
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
				'description'       => $this->from_description(),
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => array( $this, 'validate_date' ),
			),
			'to'       => array(
				'type'              => 'string',
				'default'           => '',
				'description'       => $this->to_description(),
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
		$per_page = min( $per_page, static::MAX_PER_PAGE );
		$page     = max( $page, 1 );

		$filters = array(
			'status'    => (string) $request->get_param( 'status' ),
			'date_from' => (string) $request->get_param( 'from' ),
			'date_to'   => (string) $request->get_param( 'to' ),
		);

		$transactions = $this->get_transactions(
			array_merge(
				array(
					'limit'  => $per_page,
					'offset' => ( $page - 1 ) * $per_page,
				),
				$filters,
				array(
					'orderby' => 'created_at',
					'order'   => 'DESC',
				)
			)
		);

		$data = array();
		foreach ( $transactions as $transaction ) {
			$data[] = $this->prepare_transaction( $transaction );
		}

		return new WP_REST_Response(
			array(
				'transactions' => $data,
				'total'        => $this->count_transactions( $filters ),
				'page'         => $page,
				'per_page'     => $per_page,
			),
			200
		);
	}

	/**
	 * Read a page of transaction rows.
	 *
	 * @param array $args Query arguments: limit, offset, status, date_from,
	 *                    date_to, orderby, order.
	 * @return object[]
	 */
	protected function get_transactions( array $args ) {
		$model = $this->transaction_model();
		return $model::get_all( $args );
	}

	/**
	 * Count transaction rows matching the filters.
	 *
	 * @param array $args Filters: status, date_from, date_to.
	 * @return int
	 */
	protected function count_transactions( array $args ) {
		$model = $this->transaction_model();
		return $model::count( $args );
	}

	/**
	 * Shape a transaction row for the external response.
	 *
	 * @param object $transaction Transaction row.
	 * @return array
	 */
	protected function prepare_transaction( $transaction ) {
		$event_date_id = $transaction->event_date_id ? (int) $transaction->event_date_id : null;

		return array(
			'id'                => (int) $transaction->id,
			'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
			'amount'            => (float) ( $transaction->amount ?? 0 ),
			'currency'          => $transaction->currency ?? 'EUR',
			'mollie_fee'        => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
			'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
			'status'            => $transaction->status ?? 'unknown',
			'testmode'          => ! empty( $transaction->testmode ),
			'description'       => $transaction->description ?? '',
			'event_date_id'     => $event_date_id,
			'event_url'         => $this->event_url( $event_date_id ),
			'created_at'        => $transaction->created_at ?? '',
		);
	}

	/**
	 * Permalink of the event a transaction belongs to, when Fair Events is active.
	 *
	 * @param int|null $event_date_id Event date ID.
	 * @return string Permalink, or an empty string.
	 */
	protected function event_url( $event_date_id ) {
		if ( ! $event_date_id || ! class_exists( '\\FairEvents\\Models\\EventDates' ) ) {
			return '';
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date || empty( $event_date->event_id ) ) {
			return '';
		}

		$permalink = get_permalink( (int) $event_date->event_id );

		return $permalink ? $permalink : '';
	}
}
