<?php
/**
 * Event Invitations REST API Controller
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\API;

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
		// POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>[\d]+)/event-invitations',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_invitations' ),
					'permission_callback' => array( $this, 'send_invitations_permissions_check' ),
					'args'                => array_merge(
						$this->get_recipient_args(),
						array(
							'message' => array(
								'type'              => 'string',
								'required'          => false,
								'default'           => '',
								'sanitize_callback' => 'sanitize_textarea_field',
							),
						)
					),
				),
			)
		);

		// POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations/preview.
		// POST rather than GET: it takes the same body as the send.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>[\d]+)/event-invitations/preview',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview_invitations' ),
					'permission_callback' => array( $this, 'send_invitations_permissions_check' ),
					'args'                => $this->get_recipient_args(),
				),
			)
		);
	}

	/**
	 * Arguments naming an invitation's event date and recipients.
	 *
	 * @return array Route arguments.
	 */
	private function get_recipient_args() {
		return array(
			'event_date_id'   => array(
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
				// Hand-written args skip schema validation without this.
				'validate_callback' => 'rest_validate_request_arg',
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
				// Hand-written args skip schema validation without this.
				'validate_callback' => 'rest_validate_request_arg',
				'sanitize_callback' => function ( $value ) {
					return array_map( 'absint', (array) $value );
				},
			),
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
				__( 'You do not have permission to send event invitations.', 'fair-audience-experimental' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Resolve and validate the event an invitation request targets.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array|WP_Error Array with event_id, event_date_id and the event
	 *                        post, or an error when it cannot be invited to.
	 */
	private function validate_invitation_request( $request ) {
		$event_date_id   = (int) $request->get_param( 'event_date_id' );
		$participant_ids = $request->get_param( 'participant_ids' );
		$group_ids       = $request->get_param( 'group_ids' );

		// Resolve event_id from event_date_id.
		$event_date_obj = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date_obj ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience-experimental' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date_obj->event_id;

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience-experimental' ),
				array( 'status' => 404 )
			);
		}

		// Require at least one participant or group.
		if ( empty( $participant_ids ) && empty( $group_ids ) ) {
			return new WP_Error(
				'no_recipients',
				__( 'Please specify participant IDs or group IDs.', 'fair-audience-experimental' ),
				array( 'status' => 400 )
			);
		}

		return array(
			'event_id'      => $event_id,
			'event_date_id' => $event_date_id,
			'event'         => $event,
		);
	}

	/**
	 * Preview who an invitation would reach, without sending anything.
	 *
	 * Counts come from the same resolution the send uses. The eligible IDs
	 * are what the admin screens send once the organizer confirms, so people
	 * added to a group after the preview are never invited unseen.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function preview_invitations( $request ) {
		$target = $this->validate_invitation_request( $request );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		// Scope to this occurrence, as the send does.
		$recipients = $this->email_service->resolve_event_invitation_recipients(
			$target['event_id'],
			$request->get_param( 'participant_ids' ),
			$request->get_param( 'group_ids' ),
			true, // Skip already signed up.
			$target['event_date_id']
		);

		$excluded_counts = array(
			EmailService::INVITATION_EXCLUDED_SIGNED_UP   => 0,
			EmailService::INVITATION_EXCLUDED_UNAVAILABLE => 0,
			EmailService::INVITATION_EXCLUDED_INVALID_EMAIL => 0,
			EmailService::INVITATION_EXCLUDED_NO_CONSENT  => 0,
		);
		foreach ( $recipients['excluded'] as $excluded ) {
			++$excluded_counts[ $excluded['reason'] ];
		}

		$eligible_ids = array_map(
			function ( $participant ) {
				return (int) $participant->id;
			},
			$recipients['eligible']
		);

		return rest_ensure_response(
			array(
				'event_id'                 => $target['event_id'],
				'event_date_id'            => $target['event_date_id'],
				'event_title'              => $target['event']->post_title,
				'group_membership_count'   => $recipients['group_membership_count'],
				'candidate_count'          => $recipients['candidate_count'],
				'eligible_count'           => count( $eligible_ids ),
				'eligible_participant_ids' => $eligible_ids,
				'excluded'                 => $excluded_counts,
			)
		);
	}

	/**
	 * Send event invitations to participants or groups.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function send_invitations( $request ) {
		$target = $this->validate_invitation_request( $request );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		// Send invitations. Pass the specific event_date_id so the
		// "already signed up" skip filter — and the token URL embedded in
		// the email — both scope to this occurrence. Without this, an
		// invitation to one date in a recurring series would skip people
		// already signed up to any sibling date in the same series.
		$results = $this->email_service->send_bulk_event_invitations(
			$target['event_id'],
			$request->get_param( 'message' ),
			$request->get_param( 'participant_ids' ),
			$request->get_param( 'group_ids' ),
			true, // Skip already signed up.
			$target['event_date_id']
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
