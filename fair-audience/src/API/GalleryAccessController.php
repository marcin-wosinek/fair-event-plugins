<?php
/**
 * Gallery Access REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\GalleryAccessKeyRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for gallery access.
 */
class GalleryAccessController extends WP_REST_Controller {

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
	protected $rest_base = 'gallery-access';

	/**
	 * Gallery access key repository instance.
	 *
	 * @var GalleryAccessKeyRepository
	 */
	private $access_key_repository;

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Email service instance.
	 *
	 * @var EmailService
	 */
	private $email_service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->access_key_repository  = new GalleryAccessKeyRepository();
		$this->participant_repository = new ParticipantRepository();
		$this->email_service          = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/gallery-access/validate - Validate gallery access token (public).
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/validate',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'validate' ),
					'permission_callback' => '__return_true', // Public endpoint for token validation.
					'args'                => array(
						'token' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/events/{event_id}/gallery-invitations - Send bulk gallery invitations.
		register_rest_route(
			$this->namespace,
			'/events/(?P<event_id>[\d]+)/gallery-invitations',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_invitations' ),
					'permission_callback' => array( $this, 'send_invitations_permissions_check' ),
					'args'                => array(
						'event_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'message'         => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
						'participant_ids' => array(
							'type'              => 'array',
							'required'          => false,
							'default'           => array(),
							'items'             => array(
								'type' => 'integer',
							),
							'sanitize_callback' => function ( $value ) {
								return array_map( 'absint', (array) $value );
							},
						),
					),
				),
			)
		);

		// GET /fair-audience/v1/events/{event_id}/gallery-invitations/stats - Get invitation statistics.
		register_rest_route(
			$this->namespace,
			'/events/(?P<event_id>[\d]+)/gallery-invitations/stats',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_stats' ),
					'permission_callback' => array( $this, 'get_stats_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user can send gallery invitations.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function send_invitations_permissions_check( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to send gallery invitations.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Check if user can view gallery invitation stats.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function get_stats_permissions_check( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view gallery invitation stats.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Validate gallery access token and return event/participant info.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function validate( $request ) {
		$token = $request->get_param( 'token' );

		// Look up by plain token.
		$access_key = $this->access_key_repository->get_by_token( $token );

		if ( ! $access_key ) {
			return rest_ensure_response(
				array(
					'valid' => false,
				)
			);
		}

		// Get event.
		$event = get_post( $access_key->event_id );

		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return rest_ensure_response(
				array(
					'valid' => false,
				)
			);
		}

		// Get participant.
		$participant = $this->participant_repository->get_by_id( $access_key->participant_id );

		return rest_ensure_response(
			array(
				'valid'            => true,
				'event_id'         => $access_key->event_id,
				'event_title'      => $event->post_title,
				'participant_id'   => $access_key->participant_id,
				'participant_name' => $participant ? $participant->name : '',
			)
		);
	}

	/**
	 * Send gallery invitations to event participants.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function send_invitations( $request ) {
		$event_id        = $request->get_param( 'event_id' );
		$custom_message  = $request->get_param( 'message' );
		$participant_ids = $request->get_param( 'participant_ids' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Send invitations (to selected participants or all if empty).
		$results = $this->email_service->send_bulk_gallery_invitations( $event_id, $custom_message, $participant_ids );

		return rest_ensure_response(
			array(
				'success'    => true,
				'sent_count' => count( $results['sent'] ),
				'sent'       => $results['sent'],
				'failed'     => $results['failed'],
			)
		);
	}

	/**
	 * Get gallery invitation statistics for an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_stats( $request ) {
		$event_id = $request->get_param( 'event_id' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$stats = $this->access_key_repository->get_stats( $event_id );

		return rest_ensure_response( $stats );
	}
}
