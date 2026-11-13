<?php
/**
 * Shared connection log REST API controller
 *
 * @package FairPlatform
 */

namespace FairPlatform\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;
use FairPlatform\Database\AbstractConnectionRepository;

defined( 'WPINC' ) || die;

/**
 * Listing, statistics and cleanup routes for one connection log, all
 * limited to administrators. Each concrete controller names its route base,
 * repository, supported statuses and messages.
 */
abstract class AbstractConnectionsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-platform/v1';

	/**
	 * Connection repository
	 *
	 * @var AbstractConnectionRepository
	 */
	protected $repository;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->repository = $this->create_repository();
	}

	/**
	 * Repository for this connection log.
	 *
	 * @return AbstractConnectionRepository
	 */
	abstract protected function create_repository();

	/**
	 * Statuses the listing advertises as filters.
	 *
	 * @return string[]
	 */
	abstract protected function get_statuses();

	/**
	 * Response message after a cleanup.
	 *
	 * @param int $deleted Number of deleted records.
	 * @return string
	 */
	abstract protected function get_cleanup_message( $deleted );

	/**
	 * Error message for users without access.
	 *
	 * @return string
	 */
	abstract protected function get_forbidden_message();

	/**
	 * Register the routes
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-platform/v1/{rest_base} - List all connections.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'page'     => array(
							'description'       => __( 'Page number.', 'fair-platform' ),
							'type'              => 'integer',
							'default'           => 1,
							'sanitize_callback' => 'absint',
						),
						'per_page' => array(
							'description'       => __( 'Items per page.', 'fair-platform' ),
							'type'              => 'integer',
							'default'           => 50,
							'sanitize_callback' => 'absint',
						),
						'status'   => array(
							'description'       => __( 'Filter by status.', 'fair-platform' ),
							'type'              => 'string',
							'enum'              => $this->get_statuses(),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'orderby'  => array(
							'description'       => __( 'Order by field.', 'fair-platform' ),
							'type'              => 'string',
							'default'           => 'connected_at',
							'enum'              => array( 'id', 'site_name', 'status', 'connected_at' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'order'    => array(
							'description'       => __( 'Order direction.', 'fair-platform' ),
							'type'              => 'string',
							'default'           => 'DESC',
							'enum'              => array( 'ASC', 'DESC' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// GET /fair-platform/v1/{rest_base}/stats - Get statistics.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/stats',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_statistics' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		// DELETE /fair-platform/v1/{rest_base}/cleanup - Cleanup old logs.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/cleanup',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'cleanup_logs' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'days' => array(
							'description'       => __( 'Delete logs older than X days.', 'fair-platform' ),
							'type'              => 'integer',
							'default'           => 90,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Get items
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$args = array(
			'page'     => (int) $request->get_param( 'page' ),
			'per_page' => (int) $request->get_param( 'per_page' ),
			'status'   => $request->get_param( 'status' ),
			'orderby'  => $request->get_param( 'orderby' ),
			'order'    => $request->get_param( 'order' ),
		);

		$result = $this->repository->get_connections( $args );

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Get statistics
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_statistics( $request ) {
		$stats = $this->repository->get_statistics();

		return new WP_REST_Response( $stats, 200 );
	}

	/**
	 * Cleanup old logs
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function cleanup_logs( $request ) {
		$days = (int) $request->get_param( 'days' );

		$deleted = $this->repository->cleanup_old_logs( $days );

		return new WP_REST_Response(
			array(
				'deleted' => $deleted,
				'message' => $this->get_cleanup_message( $deleted ),
			),
			200
		);
	}

	/**
	 * Get items permissions check
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				$this->get_forbidden_message(),
				array( 'status' => 403 )
			);
		}

		return true;
	}
}
