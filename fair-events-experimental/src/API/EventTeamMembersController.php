<?php
/**
 * REST API controller for an event's team members.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Models\TeamMemberRepository;
use FairEventsExperimental\Services\TeamMembership;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Administrator-only read, link and unlink of the team members of an event
 * (#2394).
 *
 * GET and POST `/fair-events/v1/event-dates/{id}/team-members`, DELETE
 * `/fair-events/v1/event-dates/{id}/team-members/{member_id}`. A series has
 * one team, managed on the series: a generated occurrence reads it and
 * names the series, and writes there are refused. Each write changes one
 * membership only, so a stale screen never undoes someone else's change.
 * Responses carry member IDs, names and surnames only.
 */
class EventTeamMembersController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Resource name.
	 *
	 * @var string
	 */
	protected $rest_base = 'event-dates';

	/**
	 * Storage.
	 *
	 * @var TeamMemberRepository
	 */
	private $repository;

	/**
	 * Membership service.
	 *
	 * @var TeamMembership
	 */
	private $service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new TeamMemberRepository();
		$this->service    = new TeamMembership( $this->repository );
	}

	/**
	 * Register the routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$id_arg = array(
			'description' => __( 'Unique identifier for the event date.', 'fair-events-experimental' ),
			'type'        => 'integer',
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/team-members',
			array(
				'args' => array( 'id' => $id_arg ),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'member_id' => array(
							'description' => __( 'Team member to add to the event.', 'fair-events-experimental' ),
							'type'        => 'integer',
							'minimum'     => 1,
							'required'    => true,
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/team-members/(?P<member_id>\d+)',
			array(
				'args' => array(
					'id'        => $id_arg,
					'member_id' => array(
						'description' => __( 'Team member to remove from the event.', 'fair-events-experimental' ),
						'type'        => 'integer',
					),
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
	 * Check permission to read an event's team.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function get_items_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to add a team member.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function create_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Check permission to remove a team member.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function delete_item_permissions_check( $request ) {
		return $this->check_permission( $request );
	}

	/**
	 * Administrators who may also edit the event itself: the linked post's
	 * edit_post for a linked event (an occurrence uses its series' post).
	 * A missing event date passes through to the callback's 404.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	private function check_permission( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return $this->forbidden();
		}

		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return true;
		}

		$post_id = (int) $event_date->get_resolved_event_id();
		if ( $post_id > 0 && get_post( $post_id ) && ! current_user_can( 'edit_post', $post_id ) ) {
			return $this->forbidden();
		}

		return true;
	}

	/**
	 * Read the team of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_items( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		return new WP_REST_Response( $this->response( $event_date ), 200 );
	}

	/**
	 * Add a member to the team of an event date. Adding a member who is
	 * already on the team changes nothing.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		$refused = $this->refuse_on_occurrence( $event_date );
		if ( $refused ) {
			return $refused;
		}

		$result = $this->repository->link( (int) $event_date->id, (int) $request['member_id'] );

		if ( 'not_found' === $result ) {
			return new WP_Error(
				'rest_team_member_not_found',
				__( 'This team member no longer exists. Reload the page and choose another one.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}

		if ( 'failed' === $result ) {
			return new WP_Error(
				'rest_team_member_not_linked',
				__( 'The team member could not be added. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->response( $event_date ), 'created' === $result ? 201 : 200 );
	}

	/**
	 * Remove a member from the team of an event date. Their profile and
	 * other events are kept; removing a member who is not on the team
	 * changes nothing.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		$refused = $this->refuse_on_occurrence( $event_date );
		if ( $refused ) {
			return $refused;
		}

		if ( ! $this->repository->unlink( (int) $event_date->id, (int) $request['member_id'] ) ) {
			return new WP_Error(
				'rest_team_member_not_unlinked',
				__( 'The team member could not be removed. Try again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $this->response( $event_date ), 200 );
	}

	/**
	 * Refuse a write to a generated occurrence, whose team is the series'.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @return WP_Error|null
	 */
	private function refuse_on_occurrence( EventDates $event_date ) {
		$owner_id = TeamMembership::owner_id( $event_date );
		if ( $owner_id === (int) $event_date->id ) {
			return null;
		}

		return new WP_Error(
			'rest_team_managed_on_series',
			__( 'This date is part of a series. Its team is managed on the series.', 'fair-events-experimental' ),
			array(
				'status'               => 409,
				'series_event_date_id' => $owner_id,
			)
		);
	}

	/**
	 * Build the response for an event date.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @return array{owner_event_date_id: int, series_event_date_id: int|null, members: array[]}
	 */
	private function response( EventDates $event_date ) {
		$owner_id = TeamMembership::owner_id( $event_date );

		return array(
			'owner_event_date_id'  => $owner_id,
			'series_event_date_id' => $owner_id !== (int) $event_date->id ? $owner_id : null,
			'members'              => $this->service->members( $event_date ),
		);
	}

	/**
	 * Error for a missing event date.
	 *
	 * @return WP_Error
	 */
	private function not_found() {
		return new WP_Error(
			'rest_event_date_not_found',
			__( 'Event date not found.', 'fair-events-experimental' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * Error for a user who may not manage this event's team.
	 *
	 * @return WP_Error
	 */
	private function forbidden() {
		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage this event\'s team.', 'fair-events-experimental' ),
			array( 'status' => rest_authorization_required_code() )
		);
	}
}
