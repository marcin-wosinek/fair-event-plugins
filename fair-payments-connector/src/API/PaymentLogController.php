<?php
/**
 * REST API Controller for Payment Logs
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Database\PaymentLogRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

/**
 * Read-only REST endpoints for payment log entries.
 *
 * Admin-only — log rows can leak request details, so callers must hold manage_options.
 */
class PaymentLogController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)/log',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_transaction_log' ),
					'permission_callback' => array( $this, 'permissions_check' ),
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

		register_rest_route(
			$this->namespace,
			'/log',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_recent_log' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'level'  => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'event'  => array(
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'limit'  => array(
							'type'              => 'integer',
							'default'           => 100,
							'sanitize_callback' => 'absint',
						),
						'offset' => array(
							'type'              => 'integer',
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Capability check.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * GET /transactions/{id}/log
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_transaction_log( WP_REST_Request $request ) {
		$transaction_id = (int) $request->get_param( 'id' );
		$repo           = new PaymentLogRepository();
		$entries        = $repo->get_by_transaction_id( $transaction_id );

		return new WP_REST_Response(
			array_map( array( $this, 'prepare_entry' ), $entries ),
			200
		);
	}

	/**
	 * GET /log
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_recent_log( WP_REST_Request $request ) {
		$repo    = new PaymentLogRepository();
		$entries = $repo->get_recent(
			array(
				'level'  => (string) $request->get_param( 'level' ),
				'event'  => (string) $request->get_param( 'event' ),
				'limit'  => (int) $request->get_param( 'limit' ),
				'offset' => (int) $request->get_param( 'offset' ),
			)
		);

		return new WP_REST_Response(
			array_map( array( $this, 'prepare_entry' ), $entries ),
			200
		);
	}

	/**
	 * Format a PaymentLog for the wire.
	 *
	 * @param \FairPaymentsConnector\Models\PaymentLog $entry Log entry.
	 * @return array
	 */
	private function prepare_entry( $entry ) {
		$context = null;
		if ( ! empty( $entry->context ) ) {
			$decoded = json_decode( $entry->context, true );
			$context = ( JSON_ERROR_NONE === json_last_error() ) ? $decoded : $entry->context;
		}

		return array(
			'id'             => (int) $entry->id,
			'transaction_id' => null === $entry->transaction_id ? null : (int) $entry->transaction_id,
			'level'          => $entry->level,
			'event'          => $entry->event,
			'message'        => $entry->message,
			'context'        => $context,
			'user_id'        => null === $entry->user_id ? null : (int) $entry->user_id,
			'ip_address'     => $entry->ip_address,
			'request_id'     => $entry->request_id,
			'created_at'     => $entry->created_at ? get_date_from_gmt( $entry->created_at ) : '',
		);
	}
}
