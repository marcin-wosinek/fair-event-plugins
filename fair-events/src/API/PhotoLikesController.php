<?php
/**
 * Photo Likes REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\PhotoLikeRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for photo likes.
 */
class PhotoLikesController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'photos/(?P<attachment_id>[\d]+)/likes';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-events/v1/photos/{attachment_id}/likes - Get like count.
		// POST /fair-events/v1/photos/{attachment_id}/likes - Add like.
		// DELETE /fair-events/v1/photos/{attachment_id}/likes - Remove like.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => '__return_true', // Public endpoint.
					'args'                => array(
						'attachment_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'attachment_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'attachment_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user can create a like.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to like photos.', 'fair-events' ),
				array( 'status' => 401 )
			);
		}

		return true;
	}

	/**
	 * Check if user can delete a like.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function delete_item_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to unlike photos.', 'fair-events' ),
				array( 'status' => 401 )
			);
		}

		return true;
	}

	/**
	 * Get like count for a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$attachment_id = $request->get_param( 'attachment_id' );

		// Validate attachment exists.
		$attachment = get_post( $attachment_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'invalid_attachment',
				__( 'Photo not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$repository = new PhotoLikeRepository();
		$count      = $repository->get_count( $attachment_id );

		$response = array(
			'attachment_id' => $attachment_id,
			'count'         => $count,
		);

		// Include user's like status if logged in.
		if ( is_user_logged_in() ) {
			$response['user_liked'] = $repository->has_liked( $attachment_id, get_current_user_id() );
		}

		return rest_ensure_response( $response );
	}

	/**
	 * Add a like to a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$attachment_id = $request->get_param( 'attachment_id' );
		$user_id       = get_current_user_id();

		// Validate attachment exists.
		$attachment = get_post( $attachment_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'invalid_attachment',
				__( 'Photo not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$repository = new PhotoLikeRepository();
		$like       = $repository->add_like( $attachment_id, $user_id );

		if ( ! $like ) {
			return new WP_Error(
				'like_failed',
				__( 'Failed to like photo.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$count = $repository->get_count( $attachment_id );

		return rest_ensure_response(
			array(
				'attachment_id' => $attachment_id,
				'user_liked'    => true,
				'count'         => $count,
				'like_id'       => $like->id,
			)
		);
	}

	/**
	 * Remove a like from a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$attachment_id = $request->get_param( 'attachment_id' );
		$user_id       = get_current_user_id();

		// Validate attachment exists.
		$attachment = get_post( $attachment_id );
		if ( ! $attachment || 'attachment' !== $attachment->post_type ) {
			return new WP_Error(
				'invalid_attachment',
				__( 'Photo not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$repository = new PhotoLikeRepository();
		$repository->remove_like( $attachment_id, $user_id );

		$count = $repository->get_count( $attachment_id );

		return rest_ensure_response(
			array(
				'attachment_id' => $attachment_id,
				'user_liked'    => false,
				'count'         => $count,
			)
		);
	}
}
