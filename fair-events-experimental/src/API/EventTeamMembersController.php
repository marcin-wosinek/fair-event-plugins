<?php
/**
 * REST API controller for an event's team members.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEvents\Models\EventDates;
use FairEvents\Models\ScheduleItem;
use FairEventsExperimental\Models\TeamMemberRepository;
use FairEventsExperimental\Services\TeamMembership;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Administrator-only reads and writes of an event's contributors (#2394,
 * #2422): its team and the contributors of its programme items.
 *
 * Team (owner: the event, or a series' master):
 *
 * - GET `/fair-events/v1/event-dates/{id}/team-members` — the ordered
 *   `assignments`, and `members` once each.
 * - POST and DELETE `…/team-members[/{member_id}]` — a membership without
 *   a role, as in #2394. DELETE leaves the member's roles in place.
 * - POST `…/team-assignments` `{ member_id, role }`, DELETE
 *   `…/team-assignments/{assignment_id}` and PUT `…/team-assignments/order`
 *   `{ assignment_ids }`.
 *
 * Programme (owner: the event that stores the schedule):
 *
 * - GET `…/schedule-contributors` — every schedule item with its ordered
 *   assignments.
 * - POST `…/schedule-items/{item_id}/contributors`, DELETE
 *   `…/schedule-items/{item_id}/contributors/{assignment_id}` and PUT
 *   `…/schedule-items/{item_id}/contributors/order`.
 *
 * A generated occurrence reads its series' assignments and names the
 * series; writes there are refused with 409. Each write changes one
 * assignment, or the order of one target, so a stale screen never undoes
 * someone else's change: a repeated member and role is refused (409
 * `rest_team_assignment_exists`), and an order that does not name exactly
 * the current assignments is refused (409 `rest_team_order_stale`).
 * Responses carry member IDs, names, surnames and roles only.
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
		$id_arg      = array(
			'description' => __( 'Unique identifier for the event date.', 'fair-events-experimental' ),
			'type'        => 'integer',
		);
		$item_arg    = array(
			'description' => __( 'Schedule item of the event.', 'fair-events-experimental' ),
			'type'        => 'integer',
		);
		$assign_arg  = array(
			'description' => __( 'Assignment to remove.', 'fair-events-experimental' ),
			'type'        => 'integer',
		);
		$assign_args = array(
			'member_id' => array(
				'description' => __( 'Team member to assign.', 'fair-events-experimental' ),
				'type'        => 'integer',
				'minimum'     => 1,
				'required'    => true,
			),
			'role'      => array(
				'description'       => __( 'Role slug, such as teacher or organizer.', 'fair-events-experimental' ),
				'type'              => 'string',
				'required'          => true,
				'validate_callback' => array( $this, 'validate_role' ),
			),
		);
		$order_args  = array(
			'assignment_ids' => array(
				'description'       => __( 'Every assignment of the target, in the new order.', 'fair-events-experimental' ),
				'type'              => 'array',
				'items'             => array( 'type' => 'integer' ),
				'required'          => true,
				'validate_callback' => array( $this, 'validate_order' ),
			),
		);
		$permission  = array( $this, 'check_permission' );
		$base        = '/' . $this->rest_base . '/(?P<id>\d+)';

		register_rest_route(
			$this->namespace,
			$base . '/team-members',
			array(
				'args' => array( 'id' => $id_arg ),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => $permission,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => $permission,
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
			$base . '/team-members/(?P<member_id>\d+)',
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
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/team-assignments',
			array(
				'args' => array( 'id' => $id_arg ),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_event_assignment' ),
					'permission_callback' => $permission,
					'args'                => $assign_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/team-assignments/order',
			array(
				'args' => array( 'id' => $id_arg ),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'reorder_event_assignments' ),
					'permission_callback' => $permission,
					'args'                => $order_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/team-assignments/(?P<assignment_id>\d+)',
			array(
				'args' => array(
					'id'            => $id_arg,
					'assignment_id' => $assign_arg,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_event_assignment' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/schedule-contributors',
			array(
				'args' => array( 'id' => $id_arg ),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_programme' ),
					'permission_callback' => $permission,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/schedule-items/(?P<item_id>\d+)/contributors',
			array(
				'args' => array(
					'id'      => $id_arg,
					'item_id' => $item_arg,
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item_assignment' ),
					'permission_callback' => $permission,
					'args'                => $assign_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/schedule-items/(?P<item_id>\d+)/contributors/order',
			array(
				'args' => array(
					'id'      => $id_arg,
					'item_id' => $item_arg,
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'reorder_item_assignments' ),
					'permission_callback' => $permission,
					'args'                => $order_args,
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$base . '/schedule-items/(?P<item_id>\d+)/contributors/(?P<assignment_id>\d+)',
			array(
				'args' => array(
					'id'            => $id_arg,
					'item_id'       => $item_arg,
					'assignment_id' => $assign_arg,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item_assignment' ),
					'permission_callback' => $permission,
				),
			)
		);
	}

	/**
	 * Validate a role slug.
	 *
	 * @param mixed $value Submitted role.
	 * @return true|WP_Error
	 */
	public function validate_role( $value ) {
		if ( TeamMemberRepository::is_valid_role( $value ) ) {
			return true;
		}

		return new WP_Error(
			'rest_invalid_param',
			sprintf(
				/* translators: %d: maximum role length in characters */
				__( 'Enter a role of up to %d lowercase letters, digits, hyphens or underscores, starting with a letter, such as teacher or organizer.', 'fair-events-experimental' ),
				TeamMemberRepository::ROLE_MAX_LENGTH
			)
		);
	}

	/**
	 * Validate a submitted order: positive IDs, each once.
	 *
	 * @param mixed                $value   Submitted assignment IDs.
	 * @param WP_REST_Request|null $request Request object.
	 * @param string               $param   Parameter name.
	 * @return true|WP_Error
	 */
	public function validate_order( $value, $request = null, $param = 'assignment_ids' ) {
		$message = __( 'Send every assignment of the list, in the new order.', 'fair-events-experimental' );
		if ( ! is_array( $value ) || count( $value ) > TeamMemberRepository::MAX_ASSIGNMENTS ) {
			return new WP_Error( 'rest_invalid_param', $message );
		}

		$valid = rest_validate_value_from_schema(
			$value,
			array(
				'type'  => 'array',
				'items' => array(
					'type'    => 'integer',
					'minimum' => 1,
				),
			),
			$param
		);
		if ( is_wp_error( $valid ) ) {
			return new WP_Error( 'rest_invalid_param', $message );
		}

		$ids = array_map( 'intval', $value );
		if ( count( array_unique( $ids ) ) !== count( $ids ) ) {
			return new WP_Error( 'rest_invalid_param', __( 'Each assignment can appear only once in the order.', 'fair-events-experimental' ) );
		}

		return true;
	}

	/**
	 * Administrators who may also edit the event itself: the linked post's
	 * edit_post for a linked event (an occurrence uses its series' post).
	 * A missing event date passes through to the callback's 404.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return true|WP_Error
	 */
	public function check_permission( $request ) {
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

		return $this->team_response( $event_date, 200 );
	}

	/**
	 * Add a member to the team of an event date without a role. Adding a
	 * member who already has a membership without a role changes nothing.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$event_date = $this->writable_team_owner( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$result = $this->repository->link( (int) $event_date->id, (int) $request['member_id'] );
		$error  = $this->add_error( $result );
		if ( $error && 'exists' !== $result ) {
			return $error;
		}

		return $this->team_response( $event_date, 'created' === $result ? 201 : 200 );
	}

	/**
	 * Remove a member's membership without a role from the team of an
	 * event date. Their profile, roles and other events are kept; removing
	 * a membership that does not exist changes nothing.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$event_date = $this->writable_team_owner( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		if ( ! $this->repository->unlink( (int) $event_date->id, (int) $request['member_id'] ) ) {
			return $this->remove_failed();
		}

		return $this->team_response( $event_date, 200 );
	}

	/**
	 * Append a role-bearing assignment to the team of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_event_assignment( $request ) {
		$event_date = $this->writable_team_owner( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$added = $this->repository->add_assignment( (int) $event_date->id, TeamMemberRepository::EVENT_TARGET, (int) $request['member_id'], (string) $request['role'] );
		$error = $this->add_error( $added['result'] );
		if ( $error ) {
			return $error;
		}

		return $this->team_response( $event_date, 201 );
	}

	/**
	 * Remove one assignment from the team of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_event_assignment( $request ) {
		$event_date = $this->writable_team_owner( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		if ( ! $this->repository->remove_assignment( (int) $event_date->id, TeamMemberRepository::EVENT_TARGET, (int) $request['assignment_id'] ) ) {
			return $this->remove_failed();
		}

		return $this->team_response( $event_date, 200 );
	}

	/**
	 * Reorder the team of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function reorder_event_assignments( $request ) {
		$event_date = $this->writable_team_owner( $request );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		$error = $this->reorder_error( $this->repository->reorder( (int) $event_date->id, TeamMemberRepository::EVENT_TARGET, (array) $request['assignment_ids'] ) );
		if ( $error ) {
			return $error;
		}

		return $this->team_response( $event_date, 200 );
	}

	/**
	 * Read the programme contributors of an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_programme( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		return $this->programme_response( $event_date, 200 );
	}

	/**
	 * Append a contributor to a programme item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item_assignment( $request ) {
		$target = $this->writable_programme_item( $request );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		$added = $this->repository->add_assignment( (int) $target['event_date']->id, $target['item_id'], (int) $request['member_id'], (string) $request['role'] );
		$error = $this->add_error( $added['result'] );
		if ( $error ) {
			return $error;
		}

		return $this->programme_response( $target['event_date'], 201 );
	}

	/**
	 * Remove one contributor from a programme item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item_assignment( $request ) {
		$target = $this->writable_programme_item( $request );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		if ( ! $this->repository->remove_assignment( (int) $target['event_date']->id, $target['item_id'], (int) $request['assignment_id'] ) ) {
			return $this->remove_failed();
		}

		return $this->programme_response( $target['event_date'], 200 );
	}

	/**
	 * Reorder the contributors of a programme item.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function reorder_item_assignments( $request ) {
		$target = $this->writable_programme_item( $request );
		if ( is_wp_error( $target ) ) {
			return $target;
		}

		$error = $this->reorder_error( $this->repository->reorder( (int) $target['event_date']->id, $target['item_id'], (array) $request['assignment_ids'] ) );
		if ( $error ) {
			return $error;
		}

		return $this->programme_response( $target['event_date'], 200 );
	}

	/**
	 * The requested event date when it owns its team; otherwise the error
	 * to answer with.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return EventDates|WP_Error
	 */
	private function writable_team_owner( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		$owner_id = TeamMembership::owner_id( $event_date );
		if ( $owner_id !== (int) $event_date->id ) {
			return new WP_Error(
				'rest_team_managed_on_series',
				__( 'This date is part of a series. Its team is managed on the series.', 'fair-events-experimental' ),
				array(
					'status'               => 409,
					'series_event_date_id' => $owner_id,
				)
			);
		}

		return $event_date;
	}

	/**
	 * The requested event date and schedule item when the event stores the
	 * schedule and the item is on it; otherwise the error to answer with.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array{event_date: EventDates, item_id: int}|WP_Error
	 */
	private function writable_programme_item( $request ) {
		$event_date = EventDates::get_by_id( (int) $request['id'] );
		if ( ! $event_date ) {
			return $this->not_found();
		}

		$owner_id = TeamMembership::programme_owner_id( $event_date );
		if ( $owner_id !== (int) $event_date->id ) {
			return new WP_Error(
				'rest_schedule_managed_on_series',
				__( 'This date is part of a series. Its programme contributors are managed in the series’ schedule.', 'fair-events-experimental' ),
				array(
					'status'               => 409,
					'series_event_date_id' => $owner_id,
				)
			);
		}

		$item_id = (int) $request['item_id'];
		$on_it   = false;
		foreach ( ScheduleItem::get_all_by_event_date_id( $owner_id ) as $item ) {
			if ( (int) $item->id === $item_id ) {
				$on_it = true;
				break;
			}
		}
		if ( ! $on_it ) {
			return new WP_Error(
				'rest_schedule_item_not_found',
				__( 'This schedule item is not on the event’s schedule. Reload the page; it may have been removed.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'event_date' => $event_date,
			'item_id'    => $item_id,
		);
	}

	/**
	 * Error for an assignment that was not added, or null when it was.
	 *
	 * @param string $result Repository result.
	 * @return WP_Error|null
	 */
	private function add_error( $result ) {
		switch ( $result ) {
			case 'created':
				return null;
			case 'exists':
				return new WP_Error(
					'rest_team_assignment_exists',
					__( 'This person already has this role here. Choose another role or person.', 'fair-events-experimental' ),
					array( 'status' => 409 )
				);
			case 'not_found':
				return new WP_Error(
					'rest_team_member_not_found',
					__( 'This team member no longer exists. Reload the page and choose another one.', 'fair-events-experimental' ),
					array( 'status' => 404 )
				);
			case 'full':
				return new WP_Error(
					'rest_team_assignments_full',
					sprintf(
						/* translators: %d: maximum number of assignments */
						__( 'A list can hold up to %d contributors.', 'fair-events-experimental' ),
						TeamMemberRepository::MAX_ASSIGNMENTS
					),
					array( 'status' => 409 )
				);
			default:
				return new WP_Error(
					'rest_team_member_not_linked',
					__( 'The team member could not be added. Try again.', 'fair-events-experimental' ),
					array( 'status' => 500 )
				);
		}
	}

	/**
	 * Error for an order that was not saved, or null when it was.
	 *
	 * @param string $result Repository result.
	 * @return WP_Error|null
	 */
	private function reorder_error( $result ) {
		if ( 'reordered' === $result ) {
			return null;
		}

		if ( 'stale' === $result ) {
			return new WP_Error(
				'rest_team_order_stale',
				__( 'This list changed meanwhile, so the new order was not saved. Reload it and move the person again.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		return new WP_Error(
			'rest_team_order_not_saved',
			__( 'The new order could not be saved. Try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Error for an assignment that could not be removed.
	 *
	 * @return WP_Error
	 */
	private function remove_failed() {
		return new WP_Error(
			'rest_team_member_not_unlinked',
			__( 'The team member could not be removed. Try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * The team of an event date.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @param int        $status     Success status.
	 * @return WP_REST_Response|WP_Error
	 */
	private function team_response( EventDates $event_date, $status ) {
		$owner_id    = TeamMembership::owner_id( $event_date );
		$assignments = $this->repository->assignments_of( $owner_id );
		if ( null === $assignments ) {
			return $this->read_failed();
		}

		return new WP_REST_Response(
			array(
				'owner_event_date_id'  => $owner_id,
				'series_event_date_id' => $owner_id !== (int) $event_date->id ? $owner_id : null,
				'members'              => $this->service->members( $event_date ),
				'assignments'          => self::present( $assignments ),
			),
			$status
		);
	}

	/**
	 * The programme contributors of an event date: every schedule item of
	 * the schedule owner, in programme order, with its assignments.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @param int        $status     Success status.
	 * @return WP_REST_Response|WP_Error
	 */
	private function programme_response( EventDates $event_date, $status ) {
		$owner_id  = TeamMembership::programme_owner_id( $event_date );
		$programme = $this->repository->programme_assignments_of( $owner_id );
		if ( null === $programme ) {
			return $this->read_failed();
		}

		$items = array();
		foreach ( TeamMembership::schedule_item_titles( $owner_id ) as $item_id => $title ) {
			$items[] = array(
				'schedule_item_id' => $item_id,
				'title'            => $title,
				'assignments'      => self::present( $programme[ $item_id ] ?? array() ),
			);
		}

		return new WP_REST_Response(
			array(
				'owner_event_date_id'  => $owner_id,
				'series_event_date_id' => $owner_id !== (int) $event_date->id ? $owner_id : null,
				'items'                => $items,
			),
			$status
		);
	}

	/**
	 * Assignments as the organizer sees them; a missing profile is shown
	 * by an empty name so it can still be removed.
	 *
	 * @param array[] $assignments Repository assignments.
	 * @return array[]
	 */
	private static function present( array $assignments ) {
		return array_map(
			static function ( $assignment ) {
				$assignment['name']    = (string) $assignment['name'];
				$assignment['surname'] = (string) $assignment['surname'];
				return $assignment;
			},
			$assignments
		);
	}

	/**
	 * Error for a failed read.
	 *
	 * @return WP_Error
	 */
	private function read_failed() {
		return new WP_Error(
			'rest_team_not_read',
			__( 'The contributors could not be loaded. Try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
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
