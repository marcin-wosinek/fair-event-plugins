<?php
/**
 * Invitation Tokens REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\InvitationToken;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketTypeGroupRestriction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for managing invitation tokens.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class InvitationTokensController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// Admin: list all tokens for an event date.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/invitation-tokens',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// Participant: generate an invitation token.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/invitation-tokens/generate',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'generate_token' ),
					'permission_callback' => array( $this, 'generate_permissions_check' ),
					'args'                => array(
						'event_date_id'     => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_token' => array(
							'type'     => 'string',
							'required' => false,
							'default'  => '',
						),
						'max_uses'          => array(
							'type'     => 'integer',
							'required' => false,
							'default'  => 1,
						),
					),
				),
			)
		);

		// Admin: bulk create invitation tokens.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/invitation-tokens/bulk',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'bulk_create' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'group_id'      => array(
							'type'     => 'integer',
							'required' => true,
						),
						'mode'          => array(
							'type'     => 'string',
							'required' => false,
							'default'  => 'unlinked',
							'enum'     => array( 'unlinked', 'per_member' ),
						),
						'count'         => array(
							'type'     => 'integer',
							'required' => false,
							'default'  => 5,
							'minimum'  => 1,
							'maximum'  => 100,
						),
						'max_uses'      => array(
							'type'     => 'integer',
							'required' => false,
							'default'  => 1,
						),
					),
				),
			)
		);

		// Admin: delete an invitation token.
		register_rest_route(
			$this->namespace,
			'/invitation-tokens/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_token' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// Public: validate an invitation token.
		register_rest_route(
			$this->namespace,
			'/invitation-tokens/validate',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'validate_token' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'token' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Admin permission check.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error
	 */
	public function admin_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to view invitation tokens.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * Permission check for generating tokens.
	 * Requires logged-in user or valid participant token.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error
	 */
	public function generate_permissions_check( $request ) {
		$user_id           = get_current_user_id();
		$participant_token = $request->get_param( 'participant_token' );

		if ( $user_id ) {
			return true;
		}

		if ( ! empty( $participant_token ) && class_exists( \FairAudience\Services\ParticipantToken::class ) ) {
			$token_data = \FairAudience\Services\ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				return true;
			}
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You must be logged in or have a valid participant link.', 'fair-events' ),
			array( 'status' => 401 )
		);
	}

	/**
	 * Get all invitation tokens for an event date (admin).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		$tokens        = InvitationToken::get_all_by_event_date_id( $event_date_id );

		$participant_repo = null;
		if ( class_exists( \FairAudience\Database\ParticipantRepository::class ) ) {
			$participant_repo = new \FairAudience\Database\ParticipantRepository();
		}

		$group_repo = null;
		if ( class_exists( \FairAudience\Database\GroupRepository::class ) ) {
			$group_repo = new \FairAudience\Database\GroupRepository();
		}

		$items = array();
		foreach ( $tokens as $token ) {
			$data = $token->to_array();

			$data['inviter_name'] = '';
			if ( $participant_repo ) {
				$inviter = $participant_repo->get_by_id( $token->inviter_participant_id );
				if ( $inviter ) {
					$data['inviter_name'] = trim( $inviter->name . ' ' . ( $inviter->surname ?? '' ) );
				}
			}

			$data['invitee_name'] = '';
			if ( $participant_repo && $token->invitee_participant_id ) {
				$invitee = $participant_repo->get_by_id( $token->invitee_participant_id );
				if ( $invitee ) {
					$data['invitee_name'] = trim( $invitee->name . ' ' . ( $invitee->surname ?? '' ) );
				}
			}

			$data['group_name'] = '';
			if ( $group_repo ) {
				$group = $group_repo->get_by_id( $token->group_id );
				if ( $group ) {
					$data['group_name'] = $group->name;
				}
			}

			$items[] = $data;
		}

		return rest_ensure_response( $items );
	}

	/**
	 * Generate an invitation token for the requesting participant.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function generate_token( $request ) {
		$event_date_id     = (int) $request->get_param( 'event_date_id' );
		$participant_token = $request->get_param( 'participant_token' );
		$max_uses          = max( 1, (int) $request->get_param( 'max_uses' ) );

		$participant = $this->resolve_participant( $participant_token );
		if ( is_wp_error( $participant ) ) {
			return $participant;
		}

		// Find invitation-only ticket types for this event date and which groups allow invitations.
		$ticket_types = TicketType::get_all_by_event_date_id( $event_date_id );
		$invite_types = array_filter( $ticket_types, fn( $tt ) => $tt->invitation_only );

		if ( empty( $invite_types ) ) {
			return new WP_Error(
				'no_invitation_tickets',
				__( 'This event has no invitation-only ticket types.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Check participant's group memberships against invitation-only ticket type groups.
		$group_participant_repo = new \FairAudience\Database\GroupParticipantRepository();
		$memberships            = $group_participant_repo->get_by_participant( $participant->id );
		$participant_group_ids  = array_map( fn( $m ) => (int) $m->group_id, $memberships );

		$eligible_group_id = null;
		foreach ( $invite_types as $tt ) {
			$allowed_groups = TicketTypeGroupRestriction::get_group_ids_by_ticket_type_id( $tt->id );
			if ( empty( $allowed_groups ) ) {
				continue;
			}
			$matching = array_intersect( $allowed_groups, $participant_group_ids );
			if ( ! empty( $matching ) ) {
				$eligible_group_id = reset( $matching );
				break;
			}
		}

		if ( ! $eligible_group_id ) {
			return new WP_Error(
				'not_eligible',
				__( 'You are not in a group that can send invitations for this event.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		$token = InvitationToken::create(
			$event_date_id,
			$eligible_group_id,
			$participant->id,
			$max_uses
		);

		if ( ! $token ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to create invitation token.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response( $token->to_array() );
	}

	/**
	 * Validate an invitation token (public endpoint).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function validate_token( $request ) {
		$token_string = $request->get_param( 'token' );
		$token        = InvitationToken::get_by_token( $token_string );

		if ( ! $token ) {
			return new WP_Error(
				'invalid_token',
				__( 'This invitation link is not valid.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $token->is_valid() ) {
			return new WP_Error(
				'token_expired',
				__( 'This invitation link has expired or has been fully used.', 'fair-events' ),
				array( 'status' => 410 )
			);
		}

		// Get inviter name for display.
		$inviter_name = '';
		if ( class_exists( \FairAudience\Database\ParticipantRepository::class ) ) {
			$participant_repo = new \FairAudience\Database\ParticipantRepository();
			$inviter          = $participant_repo->get_by_id( $token->inviter_participant_id );
			if ( $inviter ) {
				$inviter_name = trim( $inviter->name . ' ' . ( $inviter->surname ?? '' ) );
			}
		}

		return rest_ensure_response(
			array(
				'valid'         => true,
				'event_date_id' => $token->event_date_id,
				'inviter_name'  => $inviter_name,
				'uses_left'     => $token->max_uses - $token->uses_count,
			)
		);
	}

	/**
	 * Bulk create invitation tokens (admin).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function bulk_create( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		$group_id      = (int) $request->get_param( 'group_id' );
		$mode          = $request->get_param( 'mode' );
		$max_uses      = max( 1, (int) $request->get_param( 'max_uses' ) );

		$created = array();

		if ( 'per_member' === $mode ) {
			if ( ! class_exists( \FairAudience\Database\GroupParticipantRepository::class ) ) {
				return new WP_Error(
					'missing_dependency',
					__( 'Fair Audience plugin is required.', 'fair-events' ),
					array( 'status' => 500 )
				);
			}

			$group_participant_repo = new \FairAudience\Database\GroupParticipantRepository();
			$memberships            = $group_participant_repo->get_by_group( $group_id );

			foreach ( $memberships as $membership ) {
				$token = InvitationToken::create(
					$event_date_id,
					$group_id,
					(int) $membership->participant_id,
					$max_uses
				);
				if ( $token ) {
					$created[] = $token->to_array();
				}
			}
		} else {
			$count = min( 100, max( 1, (int) $request->get_param( 'count' ) ) );
			for ( $i = 0; $i < $count; $i++ ) {
				$token = InvitationToken::create(
					$event_date_id,
					$group_id,
					0,
					$max_uses
				);
				if ( $token ) {
					$created[] = $token->to_array();
				}
			}
		}

		return rest_ensure_response( $created );
	}

	/**
	 * Delete an invitation token (admin).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_token( $request ) {
		$id    = (int) $request->get_param( 'id' );
		$token = InvitationToken::get_by_id( $id );

		if ( ! $token ) {
			return new WP_Error(
				'not_found',
				__( 'Token not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$token->delete();
		return rest_ensure_response( array( 'deleted' => true ) );
	}

	/**
	 * Resolve the current participant from auth context.
	 *
	 * @param string $participant_token Optional participant token.
	 * @return \FairAudience\Models\Participant|WP_Error
	 */
	private function resolve_participant( $participant_token ) {
		if ( ! class_exists( \FairAudience\Database\ParticipantRepository::class ) ) {
			return new WP_Error(
				'missing_dependency',
				__( 'Fair Audience plugin is required.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$participant_repo = new \FairAudience\Database\ParticipantRepository();
		$participant      = null;

		if ( ! empty( $participant_token ) && class_exists( \FairAudience\Services\ParticipantToken::class ) ) {
			$token_data = \FairAudience\Services\ParticipantToken::verify( $participant_token );
			if ( $token_data ) {
				$participant = $participant_repo->get_by_id( $token_data['participant_id'] );
			}
		}

		if ( ! $participant ) {
			$user_id = get_current_user_id();
			if ( $user_id ) {
				$participant = $participant_repo->get_by_user_id( $user_id );
			}
		}

		if ( ! $participant ) {
			return new WP_Error(
				'no_participant',
				__( 'Could not find your participant profile.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		return $participant;
	}
}
