<?php
/**
 * Photo Tags REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\PhotoParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for photo tags.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class PhotoTagsController extends WP_REST_Controller {

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
	protected $rest_base = 'photos/(?P<id>[\d]+)/tags';

	/**
	 * Photo participant repository.
	 *
	 * @var PhotoParticipantRepository
	 */
	private $repository;

	/**
	 * Participant repository.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repo;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository       = new PhotoParticipantRepository();
		$this->participant_repo = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET/POST /fair-audience/v1/photos/{id}/tags
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'id'             => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/photos/{id}/tags/{participant_id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<participant_id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'id'             => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/photos/batch-tag
		register_rest_route(
			$this->namespace,
			'/photos/batch-tag',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'batch_tag' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'attachment_ids' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type' => 'integer',
							),
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get tagged participants for a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function get_items( $request ) {
		$attachment_id = (int) $request->get_param( 'id' );

		$tagged = $this->repository->get_tagged_for_attachment( $attachment_id );

		$items = array();
		foreach ( $tagged as $tag ) {
			$participant = $this->participant_repo->get_by_id( $tag->participant_id );
			$items[]     = array(
				'participant_id' => $tag->participant_id,
				'name'           => $participant ? trim( $participant->name . ' ' . $participant->surname ) : '',
				'created_at'     => $tag->created_at,
			);
		}

		return rest_ensure_response( $items );
	}

	/**
	 * Tag a participant on a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function create_item( $request ) {
		$attachment_id  = (int) $request->get_param( 'id' );
		$participant_id = (int) $request->get_param( 'participant_id' );

		$result = $this->repository->add_tag( $attachment_id, $participant_id );

		if ( false === $result ) {
			return new WP_Error(
				'tag_failed',
				__( 'Failed to tag participant.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		$participant = $this->participant_repo->get_by_id( $participant_id );

		return rest_ensure_response(
			array(
				'participant_id' => $participant_id,
				'name'           => $participant ? trim( $participant->name . ' ' . $participant->surname ) : '',
			)
		);
	}

	/**
	 * Remove a tag from a photo.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function delete_item( $request ) {
		$attachment_id  = (int) $request->get_param( 'id' );
		$participant_id = (int) $request->get_param( 'participant_id' );

		$this->repository->remove_tag( $attachment_id, $participant_id );

		return rest_ensure_response( array( 'deleted' => true ) );
	}

	/**
	 * Tag one participant on multiple photos.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function batch_tag( $request ) {
		$attachment_ids = $request->get_param( 'attachment_ids' );
		$participant_id = (int) $request->get_param( 'participant_id' );

		$results = array();
		foreach ( $attachment_ids as $attachment_id ) {
			$result    = $this->repository->add_tag( (int) $attachment_id, $participant_id );
			$results[] = array(
				'attachment_id' => (int) $attachment_id,
				'success'       => false !== $result,
			);
		}

		return rest_ensure_response( $results );
	}
}
