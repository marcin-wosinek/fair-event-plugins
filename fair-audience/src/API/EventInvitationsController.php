<?php
/**
 * Event Invitations REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for event invitations.
 */
class EventInvitationsController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

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
		$this->email_service = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// POST /fair-audience/v1/events/{event_id}/event-invitations.
		register_rest_route(
			$this->namespace,
			'/events/(?P<event_id>[\d]+)/event-invitations',
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
						'group_ids'       => array(
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
						'message'         => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user can send event invitations.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed, error otherwise.
	 */
	public function send_invitations_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to send event invitations.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Send event invitations to participants or groups.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function send_invitations( $request ) {
		$event_id        = $request->get_param( 'event_id' );
		$participant_ids = $request->get_param( 'participant_ids' );
		$group_ids       = $request->get_param( 'group_ids' );
		$custom_message  = $request->get_param( 'message' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Require at least one participant or group.
		if ( empty( $participant_ids ) && empty( $group_ids ) ) {
			return new WP_Error(
				'no_recipients',
				__( 'Please specify participant IDs or group IDs.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Send invitations.
		$results = $this->email_service->send_bulk_event_invitations(
			$event_id,
			$custom_message,
			$participant_ids,
			$group_ids,
			true // Skip already signed up.
		);

		return rest_ensure_response(
			array(
				'success'       => true,
				'sent_count'    => count( $results['sent'] ),
				'skipped_count' => count( $results['skipped'] ),
				'sent'          => $results['sent'],
				'failed'        => $results['failed'],
				'skipped'       => $results['skipped'],
			)
		);
	}
}
