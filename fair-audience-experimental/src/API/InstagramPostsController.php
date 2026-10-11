<?php
/**
 * Instagram Posts REST API Controller
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\API;

use FairAudienceExperimental\Database\InstagramPostRepository;
use FairAudienceExperimental\Models\InstagramPost;
use FairAudienceExperimental\Services\InstagramPostingService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for Instagram posts.
 */
class InstagramPostsController extends WP_REST_Controller {

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
	protected $rest_base = 'instagram/posts';

	/**
	 * Instagram post repository instance.
	 *
	 * @var InstagramPostRepository
	 */
	private $repository;

	/**
	 * Instagram posting service instance.
	 *
	 * @var InstagramPostingService
	 */
	private $posting_service;

	/**
	 * Post meta key marking an attachment as a temporary Instagram upload.
	 * Nothing creates these any more; the cleanup sweep still removes the ones
	 * left by earlier versions.
	 */
	const TEMP_ATTACHMENT_META_KEY = '_fair_audience_instagram_temp';

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository      = new InstagramPostRepository();
		$this->posting_service = new InstagramPostingService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/instagram/posts - List all posts.
		// POST /fair-audience/v1/instagram/posts - Create and publish a post.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'status' => array(
							'type'              => 'string',
							'required'          => false,
							'enum'              => array( 'pending', 'publishing', 'published', 'failed' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'image_url' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'esc_url_raw',
							'description'       => __( 'Publicly accessible image URL.', 'fair-audience-experimental' ),
						),
						'caption'   => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_textarea_field',
							'description'       => __( 'Post caption.', 'fair-audience-experimental' ),
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/instagram/upload-image - Resolve an attachment's public media-library URL.
		register_rest_route(
			$this->namespace,
			'/instagram/upload-image',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'upload_image' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'attachment_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
							'description'       => __( 'WordPress attachment ID.', 'fair-audience-experimental' ),
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/instagram/posts/{id} - Delete a post record.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all Instagram posts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$status = $request->get_param( 'status' );

		$posts = $this->repository->get_all( $status );

		$items = array_map(
			function ( $post ) {
				return array(
					'id'            => $post->id,
					'ig_media_id'   => $post->ig_media_id,
					'caption'       => $post->caption,
					'image_url'     => $post->image_url,
					'permalink'     => $post->permalink,
					'status'        => $post->status,
					'error_message' => $post->error_message,
					'created_at'    => $post->created_at,
					'published_at'  => $post->published_at,
				);
			},
			$posts
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Create and publish an Instagram post.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$image_url = $request->get_param( 'image_url' );
		$caption   = $request->get_param( 'caption' );

		// Validate image URL.
		if ( empty( $image_url ) ) {
			return new WP_Error(
				'missing_image_url',
				__( 'Image URL is required.', 'fair-audience-experimental' ),
				array( 'status' => 400 )
			);
		}

		// Validate caption.
		if ( empty( $caption ) ) {
			return new WP_Error(
				'missing_caption',
				__( 'Caption is required.', 'fair-audience-experimental' ),
				array( 'status' => 400 )
			);
		}

		// Check if Instagram is configured.
		$configured = $this->posting_service->is_configured();
		if ( is_wp_error( $configured ) ) {
			return new WP_Error(
				$configured->get_error_code(),
				$configured->get_error_message(),
				array( 'status' => 400 )
			);
		}

		// Create the post record.
		$post = new InstagramPost();
		$post->populate(
			array(
				'image_url' => $image_url,
				'caption'   => $caption,
				'status'    => 'pending',
			)
		);

		if ( ! $post->save() ) {
			return new WP_Error(
				'post_create_failed',
				__( 'Failed to create post record.', 'fair-audience-experimental' ),
				array( 'status' => 500 )
			);
		}

		// Attempt to publish.
		$result = $this->posting_service->publish( $post );

		if ( is_wp_error( $result ) ) {
			// Post is saved with failed status, return error but include post data.
			return new WP_Error(
				$result->get_error_code(),
				$result->get_error_message(),
				array(
					'status' => 500,
					'post'   => array(
						'id'            => $post->id,
						'status'        => $post->status,
						'error_message' => $post->error_message,
					),
				)
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Post published successfully!', 'fair-audience-experimental' ),
				'post'    => array(
					'id'           => $post->id,
					'ig_media_id'  => $post->ig_media_id,
					'caption'      => $post->caption,
					'image_url'    => $post->image_url,
					'permalink'    => $post->permalink,
					'status'       => $post->status,
					'created_at'   => $post->created_at,
					'published_at' => $post->published_at,
				),
			)
		);
	}

	/**
	 * Delete an Instagram post record.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id   = $request->get_param( 'id' );
		$post = $this->repository->get_by_id( $id );

		if ( ! $post ) {
			return new WP_Error(
				'post_not_found',
				__( 'Post not found.', 'fair-audience-experimental' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $this->repository->delete( $id ) ) {
			return new WP_Error(
				'post_delete_failed',
				__( 'Failed to delete post.', 'fair-audience-experimental' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'deleted' => true,
				'message' => __( 'Post deleted successfully.', 'fair-audience-experimental' ),
			)
		);
	}

	/**
	 * Resolve a WordPress attachment's public media-library URL.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response with public URL or error.
	 */
	public function upload_image( $request ) {
		$attachment_id = $request->get_param( 'attachment_id' );

		// Verify attachment exists and is an image.
		if ( ! wp_attachment_is_image( $attachment_id ) ) {
			return new WP_Error(
				'invalid_attachment',
				__( 'Attachment is not a valid image.', 'fair-audience-experimental' ),
				array( 'status' => 400 )
			);
		}

		$file_path = get_attached_file( $attachment_id );
		if ( ! $file_path || ! file_exists( $file_path ) ) {
			return new WP_Error(
				'file_not_found',
				__( 'Attachment file not found.', 'fair-audience-experimental' ),
				array( 'status' => 404 )
			);
		}

		return rest_ensure_response(
			array(
				'url' => wp_get_attachment_url( $attachment_id ),
			)
		);
	}

	/**
	 * Permission callback for getting posts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for creating posts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for deleting posts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
