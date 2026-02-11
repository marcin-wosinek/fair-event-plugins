<?php
/**
 * Extra Messages REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ExtraMessageRepository;
use FairAudience\Models\ExtraMessage;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for extra messages.
 */
class ExtraMessagesController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'extra-messages';

	/**
	 * Repository instance.
	 *
	 * @var ExtraMessageRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new ExtraMessageRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/extra-messages.
		// POST /fair-audience/v1/extra-messages.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
				),
			)
		);

		// GET /fair-audience/v1/extra-messages/{id}.
		// PUT /fair-audience/v1/extra-messages/{id}.
		// DELETE /fair-audience/v1/extra-messages/{id}.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Get all extra messages.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$orderby = $request->get_param( 'orderby' ) ?? 'created_at';
		$order   = $request->get_param( 'order' ) ?? 'DESC';

		$messages = $this->repository->get_all( $orderby, $order );

		$items = array_map(
			function ( $message ) use ( $request ) {
				return $this->prepare_item_for_response( $message, $request );
			},
			$messages
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Get single extra message.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$id      = $request->get_param( 'id' );
		$message = $this->repository->get_by_id( $id );

		if ( ! $message ) {
			return new WP_Error(
				'extra_message_not_found',
				__( 'Extra message not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response( $this->prepare_item_for_response( $message, $request ) );
	}

	/**
	 * Create extra message.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$validation = $this->validate_request_data( $request );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		$message = new ExtraMessage();
		$message->populate(
			array(
				'content'   => $request->get_param( 'content' ),
				'is_active' => $request->get_param( 'is_active' ) ?? true,
			)
		);

		if ( ! $message->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to create extra message.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $message->id,
				'message' => __( 'Extra message created successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update extra message.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		$id      = $request->get_param( 'id' );
		$message = $this->repository->get_by_id( $id );

		if ( ! $message ) {
			return new WP_Error(
				'extra_message_not_found',
				__( 'Extra message not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$validation = $this->validate_request_data( $request );
		if ( is_wp_error( $validation ) ) {
			return $validation;
		}

		$message->populate(
			array(
				'id'        => $message->id,
				'content'   => $request->get_param( 'content' ) ?? $message->content,
				'is_active' => $request->get_param( 'is_active' ) ?? $message->is_active,
			)
		);

		if ( ! $message->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update extra message.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $message->id,
				'message' => __( 'Extra message updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Delete extra message.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id      = $request->get_param( 'id' );
		$message = $this->repository->get_by_id( $id );

		if ( ! $message ) {
			return new WP_Error(
				'extra_message_not_found',
				__( 'Extra message not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $message->delete() ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to delete extra message.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Extra message deleted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Validate request data for create/update.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error True if valid, WP_Error otherwise.
	 */
	private function validate_request_data( $request ) {
		$content = $request->get_param( 'content' );

		if ( empty( $content ) ) {
			return new WP_Error(
				'missing_content',
				__( 'Content is required.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Prepare item for response.
	 *
	 * @param ExtraMessage    $message Extra message model.
	 * @param WP_REST_Request $request Request object.
	 * @return array Response data.
	 */
	public function prepare_item_for_response( $message, $request ) {
		return array(
			'id'         => $message->id,
			'content'    => $message->content,
			'is_active'  => $message->is_active,
			'created_at' => $message->created_at,
			'updated_at' => $message->updated_at,
		);
	}

	/**
	 * Check permissions for reading.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for creating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for deleting.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
