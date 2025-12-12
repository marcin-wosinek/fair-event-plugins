<?php
/**
 * REST API Controller for Invitations
 *
 * @package FairRsvp
 */

namespace FairRsvp\API;

defined( 'WPINC' ) || die;

use FairRsvp\Database\InvitationRepository;
use FairRsvp\Database\RsvpRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles invitation REST API endpoints
 */
class InvitationController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-rsvp/v1';

	/**
	 * Invitation repository instance
	 *
	 * @var InvitationRepository
	 */
	private $invitation_repository;

	/**
	 * RSVP repository instance
	 *
	 * @var RsvpRepository
	 */
	private $rsvp_repository;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->invitation_repository = new InvitationRepository();
		$this->rsvp_repository       = new RsvpRepository();
	}

	/**
	 * Register the routes for invitations
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-rsvp/v1/invitations/send - Send email invitation.
		register_rest_route(
			$this->namespace,
			'/invitations/send',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_invitation' ),
					'permission_callback' => array( $this, 'send_invitation_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to send invitation for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'email'    => array(
							'description' => __( 'Email address to invite.', 'fair-rsvp' ),
							'type'        => 'string',
							'format'      => 'email',
							'required'    => true,
						),
						'message'  => array(
							'description' => __( 'Optional personal message.', 'fair-rsvp' ),
							'type'        => 'string',
						),
					),
				),
			)
		);

		// POST /fair-rsvp/v1/invitations/generate-link - Generate shareable link.
		register_rest_route(
			$this->namespace,
			'/invitations/generate-link',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'generate_link' ),
					'permission_callback' => array( $this, 'generate_link_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to generate invitation link for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/invitations/validate?token={token} - Validate invitation token.
		register_rest_route(
			$this->namespace,
			'/invitations/validate',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'validate_invitation' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'token' => array(
							'description' => __( 'Invitation token to validate.', 'fair-rsvp' ),
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);

		// POST /fair-rsvp/v1/invitations/accept - Accept invitation.
		register_rest_route(
			$this->namespace,
			'/invitations/accept',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'accept_invitation' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'token'       => array(
							'description' => __( 'Invitation token.', 'fair-rsvp' ),
							'type'        => 'string',
							'required'    => true,
						),
						'name'        => array(
							'description' => __( 'Name for RSVP (required if not logged in).', 'fair-rsvp' ),
							'type'        => 'string',
						),
						'email'       => array(
							'description' => __( 'Email for RSVP (required if not logged in).', 'fair-rsvp' ),
							'type'        => 'string',
							'format'      => 'email',
						),
						'rsvp_status' => array(
							'description' => __( 'RSVP status (yes, maybe, no).', 'fair-rsvp' ),
							'type'        => 'string',
							'enum'        => array( 'yes', 'maybe', 'no' ),
							'default'     => 'yes',
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/invitations/my-invitations?event_id={id} - Get user's sent invitations.
		register_rest_route(
			$this->namespace,
			'/invitations/my-invitations',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_my_invitations' ),
					'permission_callback' => array( $this, 'get_my_invitations_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Event ID to get invitations for.', 'fair-rsvp' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/invitations/all - Admin endpoint to get all invitations.
		register_rest_route(
			$this->namespace,
			'/invitations/all',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_all_invitations_admin' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Filter by event ID.', 'fair-rsvp' ),
							'type'        => 'integer',
						),
						'status'   => array(
							'description' => __( 'Filter by status.', 'fair-rsvp' ),
							'type'        => 'string',
							'enum'        => array( 'pending', 'accepted', 'expired' ),
						),
						'page'     => array(
							'description' => __( 'Page number.', 'fair-rsvp' ),
							'type'        => 'integer',
							'default'     => 1,
						),
						'per_page' => array(
							'description' => __( 'Items per page.', 'fair-rsvp' ),
							'type'        => 'integer',
							'default'     => 50,
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/invitations/my-stats - Get current user's invitation stats.
		register_rest_route(
			$this->namespace,
			'/invitations/my-stats',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_my_stats' ),
					'permission_callback' => array( $this, 'logged_in_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'description' => __( 'Filter by event ID.', 'fair-rsvp' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// GET /fair-rsvp/v1/invitations/stats-by-user - Admin endpoint to get invitation stats by user.
		register_rest_route(
			$this->namespace,
			'/invitations/stats-by-user',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_stats_by_user' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'event_id'   => array(
							'description' => __( 'Filter by event ID.', 'fair-rsvp' ),
							'type'        => 'integer',
						),
						'inviter_id' => array(
							'description' => __( 'Filter by inviter user ID.', 'fair-rsvp' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);
	}

	/**
	 * Send invitation by email
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function send_invitation( $request ) {
		$event_id   = (int) $request->get_param( 'event_id' );
		$email      = sanitize_email( $request->get_param( 'email' ) );
		$message    = $request->get_param( 'message' ) ? sanitize_textarea_field( $request->get_param( 'message' ) ) : '';
		$inviter_id = get_current_user_id();

		// Generate unique token.
		$token = wp_generate_password( 32, false );

		// Create invitation record.
		$invitation_id = $this->invitation_repository->create_invitation( $event_id, $inviter_id, $email, $token );

		if ( ! $invitation_id ) {
			return new WP_Error(
				'invitation_creation_failed',
				__( 'Failed to create invitation.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Send invitation email.
		$this->send_invitation_email( $invitation_id, $email, $token, $event_id, $message );

		return new WP_REST_Response(
			array(
				'success'       => true,
				'invitation_id' => $invitation_id,
				'message'       => __( 'Invitation sent successfully!', 'fair-rsvp' ),
			),
			201
		);
	}

	/**
	 * Generate shareable invitation link
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function generate_link( $request ) {
		$event_id   = (int) $request->get_param( 'event_id' );
		$inviter_id = get_current_user_id();

		// Generate unique token.
		$token = wp_generate_password( 32, false );

		// Create invitation record (without email for shareable link).
		$invitation_id = $this->invitation_repository->create_invitation( $event_id, $inviter_id, null, $token );

		if ( ! $invitation_id ) {
			return new WP_Error(
				'invitation_creation_failed',
				__( 'Failed to create invitation link.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		// Build invitation URL.
		$event_url      = get_permalink( $event_id );
		$invitation_url = add_query_arg( 'invite_token', $token, $event_url );

		return new WP_REST_Response(
			array(
				'success'        => true,
				'invitation_id'  => $invitation_id,
				'invitation_url' => $invitation_url,
				'token'          => $token,
			),
			201
		);
	}

	/**
	 * Validate invitation token
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function validate_invitation( $request ) {
		$token = sanitize_text_field( $request->get_param( 'token' ) );

		// Get invitation by token.
		$invitation = $this->invitation_repository->get_invitation_by_token( $token );

		if ( ! $invitation ) {
			return new WP_Error(
				'invalid_token',
				__( 'Invalid invitation token.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Check if expired.
		if ( $invitation['expires_at'] && strtotime( $invitation['expires_at'] ) < time() ) {
			return new WP_Error(
				'invitation_expired',
				__( 'This invitation has expired.', 'fair-rsvp' ),
				array( 'status' => 410 )
			);
		}

		// Check if already used.
		if ( 'accepted' === $invitation['invitation_status'] ) {
			return new WP_Error(
				'invitation_used',
				__( 'This invitation has already been used.', 'fair-rsvp' ),
				array( 'status' => 410 )
			);
		}

		// Get event details.
		$event = get_post( $invitation['event_id'] );

		if ( ! $event ) {
			return new WP_Error(
				'event_not_found',
				__( 'Event not found.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Get inviter details.
		$inviter = get_userdata( $invitation['inviter_user_id'] );

		return new WP_REST_Response(
			array(
				'valid'        => true,
				'event_id'     => $invitation['event_id'],
				'event_title'  => $event->post_title,
				'event_url'    => get_permalink( $event->ID ),
				'inviter_name' => $inviter ? $inviter->display_name : __( 'Unknown', 'fair-rsvp' ),
				'expires_at'   => $invitation['expires_at'],
			),
			200
		);
	}

	/**
	 * Accept invitation and create RSVP
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function accept_invitation( $request ) {
		$token       = sanitize_text_field( $request->get_param( 'token' ) );
		$name        = $request->get_param( 'name' );
		$email       = $request->get_param( 'email' );
		$rsvp_status = sanitize_text_field( $request->get_param( 'rsvp_status' ) );

		// Get invitation.
		$invitation = $this->invitation_repository->get_invitation_by_token( $token );

		if ( ! $invitation ) {
			return new WP_Error(
				'invalid_token',
				__( 'Invalid invitation token.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Validate invitation status.
		if ( 'accepted' === $invitation['invitation_status'] ) {
			return new WP_Error(
				'invitation_used',
				__( 'This invitation has already been used.', 'fair-rsvp' ),
				array( 'status' => 410 )
			);
		}

		if ( $invitation['expires_at'] && strtotime( $invitation['expires_at'] ) < time() ) {
			return new WP_Error(
				'invitation_expired',
				__( 'This invitation has expired.', 'fair-rsvp' ),
				array( 'status' => 410 )
			);
		}

		// Determine user ID (logged in or check existing user).
		$user_id = get_current_user_id();

		if ( ! $user_id ) {
			// Not logged in - require name/email for guest RSVP.
			if ( empty( $name ) || empty( $email ) ) {
				return new WP_Error(
					'missing_user_info',
					__( 'Name and email are required to accept invitation.', 'fair-rsvp' ),
					array( 'status' => 400 )
				);
			}

			// Check if there's an existing user with this email.
			$existing_user = get_user_by( 'email', sanitize_email( $email ) );
			if ( $existing_user ) {
				$user_id = $existing_user->ID;
			}
		}

		// Mark invitation as accepted (pass user_id if available, null if guest).
		$this->invitation_repository->mark_invitation_accepted( $invitation['id'], $user_id );

		// Create RSVP (either with user_id or as guest).
		if ( $user_id ) {
			// Create RSVP for registered user with invitation tracking.
			$rsvp_id = $this->rsvp_repository->upsert_rsvp(
				$invitation['event_id'],
				$user_id,
				$rsvp_status,
				$invitation['inviter_user_id'],
				$invitation['id']
			);
		} else {
			// Create guest RSVP with invitation tracking.
			$rsvp_id = $this->rsvp_repository->create_guest_rsvp(
				$invitation['event_id'],
				sanitize_text_field( $name ),
				sanitize_email( $email ),
				$rsvp_status,
				$invitation['inviter_user_id'],
				$invitation['id']
			);
		}

		if ( ! $rsvp_id ) {
			return new WP_Error(
				'rsvp_creation_failed',
				__( 'Failed to create RSVP.', 'fair-rsvp' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'success'  => true,
				'event_id' => $invitation['event_id'],
				'user_id'  => $user_id,
				'rsvp_id'  => $rsvp_id,
				'message'  => __( 'Invitation accepted successfully!', 'fair-rsvp' ),
			),
			200
		);
	}

	/**
	 * Get invitations sent by current user
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_my_invitations( $request ) {
		$event_id   = (int) $request->get_param( 'event_id' );
		$inviter_id = get_current_user_id();

		$invitations = $this->invitation_repository->get_user_invitations( $event_id, $inviter_id );

		return new WP_REST_Response( $invitations, 200 );
	}

	/**
	 * Get all invitations (admin endpoint)
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_all_invitations_admin( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$status   = $request->get_param( 'status' );
		$page     = (int) $request->get_param( 'page' );
		$per_page = (int) $request->get_param( 'per_page' );

		$offset = ( $page - 1 ) * $per_page;

		$invitations = $this->invitation_repository->get_all_invitations( $event_id, $status, $per_page, $offset );
		$total_count = $this->invitation_repository->get_invitations_count( $event_id, $status );
		$total_pages = ceil( $total_count / $per_page );

		return new WP_REST_Response(
			array(
				'invitations' => $invitations,
				'total'       => $total_count,
				'page'        => $page,
				'per_page'    => $per_page,
				'total_pages' => $total_pages,
			),
			200
		);
	}

	/**
	 * Send invitation email
	 *
	 * @param int    $invitation_id Invitation ID.
	 * @param string $email Recipient email.
	 * @param string $token Invitation token.
	 * @param int    $event_id Event ID.
	 * @param string $personal_message Optional personal message.
	 * @return void
	 */
	private function send_invitation_email( $invitation_id, $email, $token, $event_id, $personal_message = '' ) {
		$event     = get_post( $event_id );
		$inviter   = wp_get_current_user();
		$site_name = wp_specialchars_decode( get_option( 'blogname' ), ENT_QUOTES );

		// Build invitation URL.
		$event_url      = get_permalink( $event_id );
		$invitation_url = add_query_arg( 'invite_token', $token, $event_url );

		/* translators: 1: Inviter name, 2: Event title */
		$subject = sprintf( __( '%1$s invited you to %2$s', 'fair-rsvp' ), $inviter->display_name, $event->post_title );

		$message = sprintf(
			/* translators: 1: Inviter name, 2: Event title, 3: Personal message, 4: Invitation URL, 5: Site name */
			__(
				'Hi,

%1$s has invited you to: %2$s
%3$s
To RSVP for this event, please click the link below:
%4$s

Best regards,
The %5$s Team',
				'fair-rsvp'
			),
			$inviter->display_name,
			$event->post_title,
			$personal_message ? "\n\n" . $personal_message . "\n" : '',
			$invitation_url,
			$site_name
		);

		wp_mail( $email, $subject, $message );
	}

	/**
	 * Check permissions for sending invitations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if allowed, WP_Error otherwise.
	 */
	public function send_invitation_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to send invitations.', 'fair-rsvp' ),
				array( 'status' => 401 )
			);
		}

		$event_id = $request->get_param( 'event_id' );
		$user_id  = get_current_user_id();

		// Get event.
		$event = get_post( $event_id );

		if ( ! $event ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-rsvp' ),
				array( 'status' => 404 )
			);
		}

		// Find RSVP block in event content.
		$blocks     = parse_blocks( $event->post_content );
		$rsvp_block = $this->find_rsvp_block( $blocks );

		$attendance = array();
		if ( $rsvp_block && isset( $rsvp_block['attrs']['attendance'] ) ) {
			$attendance = $rsvp_block['attrs']['attendance'];
		}

		// Check if user is expected using AttendanceHelper.
		$permission = \FairRsvp\Utils\AttendanceHelper::get_user_permission(
			$user_id,
			true,
			$attendance,
			$event_id
		);

		if ( ! \FairRsvp\Utils\AttendanceHelper::is_expected( $permission ) ) {
			return new WP_Error(
				'not_expected',
				__( 'Only expected users can send invitations.', 'fair-rsvp' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Check permissions for generating links
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if allowed, WP_Error otherwise.
	 */
	public function generate_link_permissions_check( $request ) {
		return $this->send_invitation_permissions_check( $request );
	}

	/**
	 * Check permissions for getting my invitations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if allowed, WP_Error otherwise.
	 */
	public function get_my_invitations_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to view invitations.', 'fair-rsvp' ),
				array( 'status' => 401 )
			);
		}

		return true;
	}

	/**
	 * Get invitation stats for current user
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_my_stats( $request ) {
		$user_id  = get_current_user_id();
		$event_id = $request->get_param( 'event_id' );

		$stats = $this->invitation_repository->get_inviter_stats( $user_id, $event_id );

		return new WP_REST_Response(
			array(
				'stats' => $stats,
			),
			200
		);
	}

	/**
	 * Get invitation stats by user (admin endpoint)
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error object on failure.
	 */
	public function get_stats_by_user( $request ) {
		$event_id   = $request->get_param( 'event_id' );
		$inviter_id = $request->get_param( 'inviter_id' );

		// If inviter_id is provided, get stats for that specific user.
		if ( $inviter_id ) {
			$stats = $this->invitation_repository->get_inviter_stats( $inviter_id, $event_id );
		} else {
			// Otherwise, get stats for all users.
			$stats = $this->invitation_repository->get_all_inviters_stats( $event_id );
		}

		return new WP_REST_Response(
			array(
				'stats' => $stats,
			),
			200
		);
	}

	/**
	 * Check if user is logged in
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if user is logged in, WP_Error otherwise.
	 */
	public function logged_in_permissions_check( $request ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You must be logged in to view stats.', 'fair-rsvp' ),
				array( 'status' => 401 )
			);
		}
		return true;
	}

	/**
	 * Check admin permissions
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has admin permissions.
	 */
	public function admin_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Find RSVP block in parsed blocks array
	 *
	 * @param array $blocks Parsed blocks from parse_blocks().
	 * @return array|null RSVP block data or null if not found.
	 */
	private function find_rsvp_block( $blocks ) {
		foreach ( $blocks as $block ) {
			if ( 'fair-rsvp/rsvp-button' === $block['blockName'] ) {
				return $block;
			}
			// Recursively search inner blocks.
			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = $this->find_rsvp_block( $block['innerBlocks'] );
				if ( $found ) {
					return $found;
				}
			}
		}
		return null;
	}
}
