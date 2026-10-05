<?php
/**
 * Event Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\EmailConsentLog;
use FairAudience\Services\EmailService;
use FairAudience\Services\TicketActivities;
use FairAudience\Services\TicketOperations;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for event-participant relationships.
 */
class EventParticipantsController extends WP_REST_Controller {

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
	protected $rest_base = 'event-dates/(?P<event_date_id>\d+)/participants';

	/**
	 * Event participant repository.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repo;

	/**
	 * Participant repository.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repo;

	/**
	 * Purchaser and assignee details already looked up for this request,
	 * keyed by participant ID (false for a participant that no longer exists).
	 *
	 * @var array<int, array|false>
	 */
	private $ticket_people = array();

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->event_participant_repo = new EventParticipantRepository();
		$this->participant_repo       = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/event-dates/{event_date_id}/participants.
		// POST /fair-audience/v1/event-dates/{event_date_id}/participants.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'event_date_id' => array(
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
						'event_date_id'  => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'label'          => array(
							'type'    => 'string',
							'enum'    => array( 'interested', 'signed_up', 'collaborator' ),
							'default' => 'interested',
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/event-dates/{event_date_id}/participants/{participant_id}.
		// PUT /fair-audience/v1/event-dates/{event_date_id}/participants/{participant_id}.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<participant_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_date_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id'      => array(
							'type'     => 'integer',
							'required' => true,
						),
						'label'               => array(
							'type'     => 'string',
							'enum'     => array( 'interested', 'signed_up', 'collaborator' ),
							'required' => false,
						),
						'attended'            => array(
							'type'     => 'boolean',
							'required' => false,
						),
						'ticket_option_names' => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type' => 'string',
							),
						),
						'ticket_option_ids'   => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type' => 'integer',
							),
						),
						'ticket_type_id'      => array(
							'type'     => array( 'integer', 'null' ),
							'required' => false,
						),
						'admin_comment'       => array(
							'type'     => array( 'string', 'null' ),
							'required' => false,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_date_id'  => array(
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

		// POST /fair-audience/v1/event-dates/{event_date_id}/participants/{participant_id}/move.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<participant_id>\d+)/move',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'move_item' ),
					'permission_callback' => array( $this, 'move_item_permissions_check' ),
					'args'                => array(
						'event_date_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'target_event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
							'minimum'  => 1,
						),
					),
				),
			)
		);

		// GET|PUT|DELETE /fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/tickets/(?P<ticket_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_ticket' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'     => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_ticket' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_date_id'   => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_type_id'  => array(
							'type'     => 'integer',
							'required' => false,
							'minimum'  => 1,
						),
						'activity_ids'    => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type' => 'integer',
							),
						),
						'attended'        => array(
							'type'     => 'boolean',
							'required' => false,
						),
						// Confirms adding an activity past its limit.
						'override_reason' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_ticket' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'     => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/move.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/tickets/(?P<ticket_id>\d+)/move',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'move_ticket' ),
					'permission_callback' => array( $this, 'move_item_permissions_check' ),
					'args'                => array(
						'event_date_id'        => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'            => array(
							'type'     => 'integer',
							'required' => true,
						),
						'target_event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
							'minimum'  => 1,
						),
						// Confirms moving past the target date's or an activity's limit.
						'override_reason'      => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/cancel.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/tickets/(?P<ticket_id>\d+)/cancel',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'cancel_ticket' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'     => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-dates/{event_date_id}/tickets/{ticket_id}/assign.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)/tickets/(?P<ticket_id>\d+)/assign',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'assign_ticket' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_date_id'  => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ticket_id'      => array(
							'type'     => 'integer',
							'required' => true,
						),
						// An existing participant to give the ticket to.
						'participant_id' => array(
							'type'     => 'integer',
							'required' => false,
							'minimum'  => 1,
						),
						// Or the details of a participant to create.
						'participant'    => array(
							'type'       => 'object',
							'required'   => false,
							'properties' => array(
								'name'    => array( 'type' => 'string' ),
								'surname' => array( 'type' => 'string' ),
								'email'   => array( 'type' => 'string' ),
							),
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/event-dates/{event_date_id}/participants/batch.
		// POST /fair-audience/v1/event-dates/{event_date_id}/participants/batch.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/batch',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_batch_items' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_date_id'   => array(
							'type'              => 'integer',
							'required'          => true,
							'validate_callback' => function ( $param ) {
								return is_numeric( $param );
							},
						),
						'participant_ids' => array(
							'type'              => 'array',
							'required'          => true,
							'items'             => array(
								'type' => 'integer',
							),
							'validate_callback' => function ( $param ) {
								return is_array( $param ) && ! empty( $param );
							},
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_batch_items' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'event_date_id'   => array(
							'type'              => 'integer',
							'required'          => true,
							'validate_callback' => function ( $param ) {
								return is_numeric( $param );
							},
						),
						'participant_ids' => array(
							'type'              => 'array',
							'required'          => true,
							'items'             => array(
								'type' => 'integer',
							),
							'validate_callback' => function ( $param ) {
								return is_array( $param ) && ! empty( $param );
							},
						),
						'label'           => array(
							'type'     => 'string',
							'enum'     => array( 'interested', 'signed_up', 'collaborator' ),
							'required' => true,
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/event-dates/{event_date_id}/participants/marketing-consent.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/marketing-consent',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'record_marketing_consent_batch' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'validate_callback' => function ( $param ) {
								return is_numeric( $param );
							},
						),
						'marketing_ids' => array(
							'type'    => 'array',
							'default' => array(),
							'items'   => array(
								'type' => 'integer',
							),
						),
						'declined_ids'  => array(
							'type'    => 'array',
							'default' => array(),
							'items'   => array(
								'type' => 'integer',
							),
						),
					),
				),
			)
		);

		// GET /fair-audience/v1/events (list events with participant counts).
		register_rest_route(
			$this->namespace,
			'/events',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_events' ),
				'permission_callback' => 'is_user_logged_in',
				'args'                => array(
					'per_page' => array(
						'type'    => 'integer',
						'default' => 25,
						'minimum' => 1,
						'maximum' => 100,
					),
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
					'orderby'  => array(
						'type'    => 'string',
						'default' => 'event_date',
						'enum'    => array( 'title', 'event_date', 'participants' ),
					),
					'order'    => array(
						'type'    => 'string',
						'default' => 'desc',
						'enum'    => array( 'asc', 'desc' ),
					),
					'search'   => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);

		// GET /fair-audience/v1/event-dates/{event_date_id} (single event info).
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_event' ),
				'permission_callback' => 'is_user_logged_in',
				'args'                => array(
					'event_date_id' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Get all participants for an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		global $wpdb;

		$event_date_id = $request->get_param( 'event_date_id' );

		// Resolve event_id from event_date_id.
		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date->event_id;

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$event_participants = $this->event_participant_repo->get_by_event_date( $event_date_id );

		// Whole-series pass holders are stored once on the master event-date, so a
		// plain occurrence lookup misses them. Surface them on each covered occurrence.
		$event_participants = $this->append_series_pass_participants( $event_participants, $event_date );

		// Build ticket type name lookup.
		$ticket_type_names = array();
		$ticket_type_ids   = array_filter( array_unique( array_map( fn( $ep ) => $ep->ticket_type_id, $event_participants ) ) );
		if ( ! empty( $ticket_type_ids ) && class_exists( '\FairEvents\Models\TicketType' ) ) {
			foreach ( $ticket_type_ids as $tt_id ) {
				$tt = \FairEvents\Models\TicketType::get_by_id( $tt_id );
				if ( $tt ) {
					$ticket_type_names[ $tt_id ] = $tt->name;
				}
			}
		}

		// Activities each participant holds, across their tickets and
		// participant scope. Confirmed IDs exclude options still held for an
		// unpaid add-on, for views that must show only what the participant
		// actually has. The participant-scope lists hold only what is not
		// tied to a ticket: signups without tickets and unresolved history.
		$participant_option_names         = array();
		$participant_option_ids           = array();
		$participant_confirmed_option_ids = array();
		$participant_scope_option_ids     = array();
		$participant_scope_option_names   = array();
		$activity_rows                    = $this->event_participant_repo->get_activity_rows_for_relationships( $event_participants );
		foreach ( $activity_rows as $ep_id => $rows ) {
			foreach ( $rows as $row ) {
				if ( '' !== (string) $row->ticket_option_name ) {
					$participant_option_names[ $ep_id ][] = $row->ticket_option_name;
				}
				$participant_option_ids[ $ep_id ][] = (int) $row->ticket_option_id;
				if ( 'confirmed' === $row->status ) {
					$participant_confirmed_option_ids[ $ep_id ][] = (int) $row->ticket_option_id;
				}
				if ( null === $row->ticket_id ) {
					$participant_scope_option_ids[ $ep_id ][] = (int) $row->ticket_option_id;
					if ( '' !== (string) $row->ticket_option_name ) {
						$participant_scope_option_names[ $ep_id ][] = $row->ticket_option_name;
					}
				}
			}
		}

		// Individual tickets each participant holds on this date. A series
		// pass surfaced from the master is edited on the master's own list.
		$tickets_by_relationship = $this->event_participant_repo->get_tickets_for_relationships(
			array_values(
				array_filter(
					$event_participants,
					static fn( $ep ) => (int) $ep->event_date_id === (int) $event_date_id
				)
			)
		);

		// Admission follows the tickets held, not the relationship alone.
		$assigned_away = $this->assigned_away_counts( (int) $event_date_id, $event_participants );

		// Cancelled tickets stay listed under their holder, apart from the
		// tickets that admit them, until an administrator deletes them.
		$cancelled_tickets = $this->cancelled_tickets_by_participant( (int) $event_date_id, $event_participants );

		// Custom question answers captured during signup. Answers collected
		// for a ticket go with that ticket; the participant row carries only
		// those not attached to any ticket.
		$participant_questionnaire = $this->get_signup_answers_by_participant( $event_date_id );
		$ticket_answers            = $this->get_ticket_answers(
			array_merge( array(), ...array_map( static fn( $tickets ) => wp_list_pluck( $tickets, 'id' ), array_values( $tickets_by_relationship ) ) )
		);

		$items = array_map(
			function ( $ep ) use ( $ticket_type_names, $participant_option_names, $participant_option_ids, $participant_confirmed_option_ids, $participant_scope_option_ids, $participant_scope_option_names, $tickets_by_relationship, $activity_rows, $participant_questionnaire, $ticket_answers, $event_date_id, $assigned_away, $cancelled_tickets ) {
				$participant     = $this->participant_repo->get_by_id( $ep->participant_id );
				$on_this_date    = (int) $ep->event_date_id === (int) $event_date_id;
				$given_to_others = $on_this_date ? ( $assigned_away[ (int) $ep->participant_id ] ?? 0 ) : 0;
				return array(
					'id'                                => $ep->id,
					'participant_id'                    => $ep->participant_id,
					'event_date_id'                     => $ep->event_date_id,
					// A row whose event_date_id differs from the requested occurrence
					// is a whole-series pass surfaced from the master event-date.
					'is_series_pass'                    => (int) $ep->event_date_id !== (int) $event_date_id,
					'participant_name'                  => $participant ? $participant->name . ' ' . $participant->surname : '',
					'name'                              => $participant ? $participant->name : '',
					'surname'                           => $participant ? $participant->surname : '',
					'participant_email'                 => $participant ? $participant->email : '',
					'email_profile'                     => $participant ? $participant->email_profile : '',
					'instagram'                         => $participant ? $participant->instagram : '',
					'label'                             => $on_this_date
						? $this->admission_label( $ep, $tickets_by_relationship[ $ep->id ] ?? array(), $given_to_others )
						: $ep->label,
					// Active tickets this participant bought here that someone
					// else now holds.
					'assigned_away_ticket_count'        => $given_to_others,
					'ticket_type_id'                    => $ep->ticket_type_id ? (int) $ep->ticket_type_id : null,
					'ticket_type_name'                  => $ep->ticket_type_id && isset( $ticket_type_names[ $ep->ticket_type_id ] )
						? $ticket_type_names[ $ep->ticket_type_id ]
						: null,
					// Participant-level check-in: from signups without tickets, or
					// history not carried over to a ticket.
					'attended_at'                       => $ep->attended_ticket_id ? null : $ep->attended_at,
					'created_at'                        => $ep->created_at,
					'payment_expires_at'                => $ep->payment_expires_at,
					'ticket_option_names'               => array_values( array_unique( $participant_option_names[ $ep->id ] ?? array() ) ),
					'ticket_option_ids'                 => array_values( array_unique( $participant_option_ids[ $ep->id ] ?? array() ) ),
					'confirmed_ticket_option_ids'       => array_values( array_unique( $participant_confirmed_option_ids[ $ep->id ] ?? array() ) ),
					'participant_ticket_option_ids'     => $participant_scope_option_ids[ $ep->id ] ?? array(),
					'participant_ticket_option_names'   => $participant_scope_option_names[ $ep->id ] ?? array(),
					'tickets'                           => array_map(
						fn( $ticket ) => $this->build_ticket_payload( $ticket, $activity_rows[ $ep->id ] ?? array(), $ticket_answers[ (int) $ticket->id ] ?? null ),
						$tickets_by_relationship[ $ep->id ] ?? array()
					),
					'cancelled_tickets'                 => array_map(
						fn( $ticket ) => $this->build_ticket_payload( $ticket, array() ),
						$on_this_date ? ( $cancelled_tickets[ (int) $ep->participant_id ] ?? array() ) : array()
					),
					'admin_comment'                     => isset( $ep->admin_comment ) && null !== $ep->admin_comment ? $ep->admin_comment : '',
					'questionnaire_answers'             => $participant_questionnaire[ $ep->participant_id ]['answers'] ?? array(),
					'questionnaire_answers_need_review' => $participant_questionnaire[ $ep->participant_id ]['needs_review'] ?? false,
				);
			},
			$event_participants
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Append whole-series pass holders to a generated occurrence's list.
	 *
	 * Whole-series signups are stored once against the master event-date (see the
	 * retarget logic in EventSignupController), so a generated occurrence never
	 * sees them through a plain event_date_id lookup. This rebuilds that coverage
	 * for the admin list, applying the same mid-series rule used elsewhere: a pass
	 * covers occurrences starting on or after the pass's created_at.
	 *
	 * @param \FairAudience\Models\EventParticipant[] $occurrence_rows Rows already found on the occurrence.
	 * @param \FairEvents\Models\EventDates           $event_date      The requested event date.
	 * @return \FairAudience\Models\EventParticipant[] Occurrence rows plus any covering series-pass rows.
	 */
	private function append_series_pass_participants( $occurrence_rows, $event_date ) {
		// Only generated occurrences need this: the master already lists its own
		// series-pass rows, and standalone dates have no series.
		if ( 'generated' !== $event_date->occurrence_type || ! $event_date->master_id ) {
			return $occurrence_rows;
		}
		if ( ! class_exists( \FairEvents\Models\TicketType::class ) ) {
			return $occurrence_rows;
		}

		$master_id     = (int) $event_date->master_id;
		$occurrence_ts = $event_date->start_datetime ? strtotime( $event_date->start_datetime ) : null;

		$already_listed = array();
		foreach ( $occurrence_rows as $row ) {
			$already_listed[ (int) $row->participant_id ] = true;
		}

		$master_rows     = $this->event_participant_repo->get_by_event_date( $master_id );
		$master_tickets  = $this->event_participant_repo->get_tickets_for_relationships( $master_rows );
		$assigned_away   = $this->assigned_away_counts( $master_id, $master_rows );
		$is_series_scope = static function ( $ticket_type_id ) {
			static $cache = array();
			if ( ! isset( $cache[ $ticket_type_id ] ) ) {
				$tt                       = \FairEvents\Models\TicketType::get_by_id( $ticket_type_id );
				$cache[ $ticket_type_id ] = $tt && $tt->is_whole_series();
			}
			return $cache[ $ticket_type_id ];
		};

		foreach ( $master_rows as $master_row ) {
			if ( isset( $already_listed[ (int) $master_row->participant_id ] ) ) {
				continue;
			}

			// A pass given to someone else admits its holder, not its purchaser.
			$tickets = $master_tickets[ (int) $master_row->id ] ?? array();
			if ( 'signed_up' !== $this->admission_label( $master_row, $tickets, $assigned_away[ (int) $master_row->participant_id ] ?? 0 ) ) {
				continue;
			}

			// The pass is named by the relationship, or, for someone it was
			// assigned to, by the ticket they hold.
			$tt_id       = (int) $master_row->ticket_type_id;
			$covers_from = $master_row->created_at;
			if ( ! $tt_id ) {
				foreach ( $tickets as $ticket ) {
					if ( 'confirmed' === $ticket->status && $ticket->ticket_type_id && $is_series_scope( (int) $ticket->ticket_type_id ) ) {
						$tt_id       = (int) $ticket->ticket_type_id;
						$covers_from = $ticket->created_at;
						break;
					}
				}
			}
			if ( ! $tt_id || ! $is_series_scope( $tt_id ) ) {
				continue;
			}

			// Mid-series purchase: a pass only covers occurrences on or after its date.
			if ( $occurrence_ts && $covers_from && $occurrence_ts < strtotime( $covers_from ) ) {
				continue;
			}

			$pass_row                 = clone $master_row;
			$pass_row->label          = 'signed_up';
			$pass_row->ticket_type_id = $tt_id;

			$already_listed[ (int) $master_row->participant_id ] = true;
			$occurrence_rows[]                                   = $pass_row;
		}

		return $occurrence_rows;
	}

	/**
	 * Count the active tickets each relationship's participant bought on an
	 * event date that someone else now holds.
	 *
	 * @param int                                     $event_date_id      Event date ID.
	 * @param \FairAudience\Models\EventParticipant[] $event_participants Relationships; only those on the event date are counted.
	 * @return array<int, int> Counts keyed by participant ID; empty when tickets are unavailable.
	 */
	private function assigned_away_counts( $event_date_id, array $event_participants ) {
		if ( ! TicketActivities::available() || ! method_exists( \FairEvents\Models\EventTicket::class, 'count_assigned_away' ) ) {
			return array();
		}

		$participant_ids = array();
		foreach ( $event_participants as $event_participant ) {
			if ( (int) $event_participant->event_date_id === (int) $event_date_id ) {
				$participant_ids[] = (int) $event_participant->participant_id;
			}
		}

		return \FairEvents\Models\EventTicket::count_assigned_away( (int) $event_date_id, $participant_ids );
	}

	/**
	 * The cancelled tickets each relationship's participant holds on an
	 * event date, leaving out those an administrator deleted.
	 *
	 * @param int                                     $event_date_id      Event date ID.
	 * @param \FairAudience\Models\EventParticipant[] $event_participants Relationships; only those on the event date are looked up.
	 * @return array<int, object[]> Tickets keyed by participant ID; empty when tickets cannot be cancelled individually.
	 */
	private function cancelled_tickets_by_participant( $event_date_id, array $event_participants ) {
		if ( ! TicketOperations::available() ) {
			return array();
		}

		$participant_ids = array();
		foreach ( $event_participants as $event_participant ) {
			if ( (int) $event_participant->event_date_id === (int) $event_date_id ) {
				$participant_ids[] = (int) $event_participant->participant_id;
			}
		}

		return \FairEvents\Models\EventTicket::get_held_by_participants( (int) $event_date_id, $participant_ids, array( 'cancelled' ) );
	}

	/**
	 * A relationship's label once the tickets held on its date are taken
	 * into account. Someone holding a confirmed ticket another participant
	 * bought is signed up, though their relationship only lists them; a
	 * purchaser whose tickets are all held by others no longer is. The
	 * stored label is never changed: it is what applies again when a ticket
	 * comes back or is given away.
	 *
	 * @param \FairAudience\Models\EventParticipant $event_participant Relationship.
	 * @param object[]                              $tickets           Active tickets the participant holds on the relationship's date.
	 * @param int                                   $assigned_away     Active tickets they bought there that someone else holds.
	 * @return string
	 */
	private function admission_label( $event_participant, array $tickets, $assigned_away ) {
		$label = (string) $event_participant->label;

		if ( 'interested' === $label ) {
			foreach ( $tickets as $ticket ) {
				if ( 'confirmed' === $ticket->status && (int) $ticket->purchaser_participant_id !== (int) $ticket->holder_participant_id ) {
					return 'signed_up';
				}
			}
		}

		if ( 'signed_up' === $label && ! $tickets && $assigned_away > 0 ) {
			return 'interested';
		}

		return $label;
	}

	/**
	 * Build a map of participant ID → custom question answers for the signups
	 * on an event date that are not attached to a ticket. Answers come from
	 * "Event Signup" questionnaire submissions (created by the Event Signup
	 * blocks); those collected for a ticket are shown with the ticket
	 * instead (see get_ticket_answers()). File-upload answers gain a
	 * resolved URL, mirroring QuestionnaireResponsesController.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Map of participant_id => array{answers: array, needs_review: bool}.
	 */
	private function get_signup_answers_by_participant( $event_date_id ) {
		if ( ! class_exists( '\FairForm\Database\QuestionnaireSubmissionRepository' ) ) {
			return array();
		}

		$submission_repo = new \FairForm\Database\QuestionnaireSubmissionRepository();
		$answer_repo     = new \FairForm\Database\QuestionnaireAnswerRepository();

		$submissions = $submission_repo->get_by_filters(
			array(
				'event_date_id' => $event_date_id,
				'title'         => __( 'Event Signup', 'fair-audience' ),
			)
		);

		$by_participant = array();
		foreach ( $submissions as $submission ) {
			if ( ! empty( $submission->ticket_id ) ) {
				continue;
			}

			// One signup submission per participant; get_by_filters orders by
			// created_at DESC, so the first seen is the newest — keep that.
			if ( isset( $by_participant[ $submission->participant_id ] ) ) {
				continue;
			}

			$answers_data = array();
			foreach ( $answer_repo->get_by_submission( $submission->id ) as $answer ) {
				$answers_data[] = $this->format_signup_answer( $answer );
			}

			$by_participant[ $submission->participant_id ] = array(
				'answers'      => $answers_data,
				'needs_review' => method_exists( $submission, 'needs_review' ) && $submission->needs_review(),
			);
		}

		return $by_participant;
	}

	/**
	 * Answers attached to each of the given tickets, keyed by ticket ID (see
	 * FairForm\Services\TicketAnswers::for_tickets()). Empty when fair-form
	 * is inactive or does not record tickets yet.
	 *
	 * @param int[] $ticket_ids Ticket IDs.
	 * @return array<int, array>
	 */
	private function get_ticket_answers( array $ticket_ids ) {
		if ( ! $ticket_ids || ! class_exists( '\FairForm\Services\TicketAnswers' ) ) {
			return array();
		}

		return \FairForm\Services\TicketAnswers::for_tickets( $ticket_ids );
	}

	/**
	 * Shape one Fair Form answer for a response. File-upload answers gain a
	 * resolved URL.
	 *
	 * @param \FairForm\Models\QuestionnaireAnswer $answer Answer model.
	 * @return array
	 */
	private function format_signup_answer( $answer ) {
		$answer_item = array(
			'question_key'  => $answer->question_key,
			'question_text' => $answer->question_text,
			'question_type' => $answer->question_type,
			'answer_value'  => $answer->answer_value,
		);

		if ( 'file_upload' === $answer->question_type && is_numeric( $answer->answer_value ) ) {
			$attachment_id  = (int) $answer->answer_value;
			$attachment_url = wp_get_attachment_url( $attachment_id );
			if ( $attachment_url ) {
				$answer_item['file_url'] = $attachment_url;
				$mime                    = get_post_mime_type( $attachment_id );
				$answer_item['is_image'] = $mime && 0 === strpos( $mime, 'image/' );
			}
		}

		return $answer_item;
	}

	/**
	 * Add participant to event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$event_date_id  = $request->get_param( 'event_date_id' );
		$participant_id = $request->get_param( 'participant_id' );
		$label          = $request->get_param( 'label' );

		// Resolve event_id from event_date_id.
		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date->event_id;

		// Validate event.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Validate participant.
		$participant = $this->participant_repo->get_by_id( $participant_id );
		if ( ! $participant ) {
			return new WP_Error(
				'invalid_participant',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$id = $this->event_participant_repo->add_participant_to_event( $event_id, $participant_id, $label, $event_date_id );

		if ( false === $id ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to add participant. May already exist.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'id'      => $id,
				'message' => __( 'Participant added successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update participant label.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		global $wpdb;

		$event_date_id       = $request->get_param( 'event_date_id' );
		$participant_id      = $request->get_param( 'participant_id' );
		$label               = $request->get_param( 'label' );
		$attended            = $request->get_param( 'attended' );
		$ticket_option_names = $request->get_param( 'ticket_option_names' );
		$ticket_option_ids   = $request->get_param( 'ticket_option_ids' );
		$has_ticket_type_id  = $request->has_param( 'ticket_type_id' );
		$ticket_type_id      = $request->get_param( 'ticket_type_id' );
		$has_admin_comment   = $request->has_param( 'admin_comment' );
		$admin_comment       = $request->get_param( 'admin_comment' );
		$has_options_payload = null !== $ticket_option_names || null !== $ticket_option_ids;

		if ( null === $label && null === $attended && ! $has_options_payload && ! $has_ticket_type_id && ! $has_admin_comment ) {
			return new WP_Error(
				'missing_fields',
				__( 'Provide at least one of: label, attended, ticket_type_id, ticket_option_ids, admin_comment.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( null !== $label ) {
			$success = $this->event_participant_repo->update_label_by_event_date( $event_date_id, $participant_id, $label );
			if ( ! $success ) {
				return new WP_Error(
					'update_failed',
					__( 'Failed to update label.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( null !== $attended ) {
			$success = $this->event_participant_repo->update_attended_at_by_event_date( $event_date_id, $participant_id, (bool) $attended );
			if ( ! $success ) {
				return new WP_Error(
					'update_failed',
					__( 'Failed to update attendance.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		if ( $has_ticket_type_id ) {
			$ep_row = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( ! $ep_row ) {
				return new WP_Error(
					'update_failed',
					__( 'Participant row not found for this event date.', 'fair-audience' ),
					array( 'status' => 404 )
				);
			}

			$new_ticket_type_id = ( null === $ticket_type_id || '' === $ticket_type_id )
				? null
				: (int) $ticket_type_id;

			if ( $new_ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
				$ticket_type = \FairEvents\Models\TicketType::get_by_id( $new_ticket_type_id );
				if ( ! $ticket_type ) {
					return new WP_Error(
						'invalid_ticket_type',
						__( 'Selected ticket type was not found.', 'fair-audience' ),
						array( 'status' => 400 )
					);
				}
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->update(
				$wpdb->prefix . 'fair_audience_event_participants',
				array(
					'ticket_type_id' => $new_ticket_type_id,
				),
				array( 'id' => (int) $ep_row->id ),
				array( '%d' ),
				array( '%d' )
			);
		}

		if ( $has_admin_comment ) {
			$ep_row = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( ! $ep_row ) {
				return new WP_Error(
					'update_failed',
					__( 'Participant row not found for this event date.', 'fair-audience' ),
					array( 'status' => 404 )
				);
			}

			$comment_value = ( null === $admin_comment || '' === $admin_comment )
				? null
				: sanitize_textarea_field( $admin_comment );

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->update(
				$wpdb->prefix . 'fair_audience_event_participants',
				array( 'admin_comment' => $comment_value ),
				array( 'id' => (int) $ep_row->id ),
				array( '%s' ),
				array( '%d' )
			);
		}

		$saved_option_ids   = array();
		$saved_option_names = array();
		if ( $has_options_payload ) {
			$updated_ep = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( $updated_ep ) {
				$ep_id      = (int) $updated_ep->id;
				$table_name = $wpdb->prefix . 'fair_audience_event_participant_options';

				// Only participant-scope activities are replaced here; history
				// carried over to a ticket stays, and tickets are edited on
				// their own (update_ticket()).
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->query(
					$wpdb->prepare(
						'DELETE FROM %i WHERE event_participant_id = %d AND ticket_id IS NULL',
						$table_name,
						$ep_id
					)
				);

				$lookup_event_date_id = $event_date_id;
				if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
					$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
					if ( $ed && 'generated' === $ed->occurrence_type && $ed->master_id ) {
						$lookup_event_date_id = (int) $ed->master_id;
					}
				}

				$by_id   = array();
				$by_name = array();
				if ( class_exists( \FairEvents\Models\TicketOption::class ) ) {
					$all_options = \FairEvents\Models\TicketOption::get_all_by_event_date_id( $lookup_event_date_id );
					foreach ( $all_options as $opt ) {
						$by_id[ (int) $opt->id ] = $opt;
						$by_name[ $opt->name ]   = $opt;
					}
				}

				$resolved_ids = array();
				if ( null !== $ticket_option_ids ) {
					foreach ( (array) $ticket_option_ids as $oid ) {
						$oid = (int) $oid;
						if ( $oid && isset( $by_id[ $oid ] ) ) {
							$resolved_ids[ $oid ] = true;
						}
					}
				} elseif ( null !== $ticket_option_names ) {
					// Backward-compat: resolve names to IDs.
					foreach ( (array) $ticket_option_names as $name ) {
						$name = sanitize_text_field( $name );
						if ( isset( $by_name[ $name ] ) ) {
							$resolved_ids[ (int) $by_name[ $name ]->id ] = true;
						}
					}
				}

				foreach ( array_keys( $resolved_ids ) as $oid ) {
					$opt = $by_id[ $oid ];
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
					$wpdb->query(
						$wpdb->prepare(
							"INSERT INTO %i (event_participant_id, ticket_option_id, ticket_option_name, status, expires_at) VALUES (%d, %d, %s, 'confirmed', NULL)
							 ON DUPLICATE KEY UPDATE ticket_option_name = VALUES(ticket_option_name), status = 'confirmed', expires_at = NULL, ticket_id = NULL",
							$table_name,
							$ep_id,
							(int) $opt->id,
							$opt->name
						)
					);
					$saved_option_ids[]   = (int) $opt->id;
					$saved_option_names[] = $opt->name;
				}
			}
		}

		$updated = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );

		$updated_ticket_type_name = null;
		if ( $updated && $updated->ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$tt = \FairEvents\Models\TicketType::get_by_id( (int) $updated->ticket_type_id );
			if ( $tt ) {
				$updated_ticket_type_name = $tt->name;
			}
		}

		return rest_ensure_response(
			array(
				'message'             => __( 'Participant updated successfully.', 'fair-audience' ),
				'label'               => $updated ? $updated->label : null,
				'attended_at'         => $updated ? $updated->attended_at : null,
				'ticket_type_id'      => $updated && $updated->ticket_type_id ? (int) $updated->ticket_type_id : null,
				'ticket_type_name'    => $updated_ticket_type_name,
				'ticket_option_ids'   => $has_options_payload ? $saved_option_ids : null,
				'ticket_option_names' => $has_options_payload ? $saved_option_names : null,
				'admin_comment'       => $updated && null !== $updated->admin_comment ? $updated->admin_comment : '',
			)
		);
	}

	/**
	 * Everything the ticket editor needs to edit one ticket: the ticket and
	 * its holder, the ticket types it can take and the event's activities,
	 * each with the places left.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_ticket( $request ) {
		$ticket = $this->find_ticket( (int) $request->get_param( 'event_date_id' ), (int) $request->get_param( 'ticket_id' ) );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		$payload = $this->build_ticket_payload(
			$ticket,
			$this->ticket_activity_rows( $ticket ),
			$this->get_ticket_answers( array( (int) $ticket->id ) )[ (int) $ticket->id ] ?? null
		);

		$participant = $ticket->holder_participant_id
			? $this->participant_repo->get_by_id( (int) $ticket->holder_participant_id )
			: null;
		if ( $participant ) {
			$payload['participant_name'] = trim( $participant->name . ' ' . $participant->surname );
		} else {
			$signup                      = \FairEvents\Models\EventSignup::get_by_id( (int) $ticket->signup_id );
			$payload['participant_name'] = $signup ? (string) $signup->name : '';
		}
		$payload['editable'] = 'confirmed' === $payload['status'];

		$current      = $ticket->ticket_type_id ? \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id ) : null;
		$ticket_types = array();
		if ( $current ) {
			$ticket_types[] = $current;
			if ( class_exists( \FairEvents\Services\TicketEditRules::class ) ) {
				$ticket_types = array_merge( $ticket_types, \FairEvents\Services\TicketEditRules::ticket_type_targets( (int) $ticket->event_date_id, $current ) );
			}
		}

		$activities = array();
		foreach ( $this->activity_catalogue( (int) $ticket->event_date_id ) as $option ) {
			$activities[] = array(
				'id'        => (int) $option->id,
				'name'      => (string) $option->name,
				'capacity'  => null === $option->capacity ? null : (int) $option->capacity,
				'remaining' => method_exists( \FairEvents\Services\TicketCapacity::class, 'remaining_for_ticket_option' )
					? \FairEvents\Services\TicketCapacity::remaining_for_ticket_option( (int) $option->id, (int) $ticket->event_date_id )
					: null,
			);
		}

		return rest_ensure_response(
			array(
				'ticket'       => $payload,
				'ticket_types' => array_map(
					static function ( $type ) use ( $current ) {
						return array(
							'id'                 => (int) $type->id,
							'label'              => (string) $type->name,
							'current'            => (int) $type->id === (int) $current->id,
							'capacity'           => null === $type->capacity ? null : (int) $type->capacity,
							'remaining'          => \FairEvents\Services\TicketCapacity::remaining_for_ticket_type( (int) $type->id ),
							'activities_enabled' => (bool) $type->activities_enabled && ! $type->is_multiple_instances(),
							'minimum_activities' => (int) $type->minimum_activities,
							'maximum_activities' => null === $type->maximum_activities ? null : (int) $type->maximum_activities,
						);
					},
					$ticket_types
				),
				'activities'   => $activities,
			)
		);
	}

	/**
	 * Update one ticket's type, activities and/or check-in together,
	 * leaving the holder's other tickets, the purchase and its payment
	 * unchanged. Every check runs before anything is written, and the
	 * writes share one transaction: a refused or failed edit changes
	 * nothing. Checking in again keeps the first check-in time;
	 * attended = false clears it. A ticket awaiting payment cannot be
	 * edited.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_ticket( $request ) {
		$ticket_type_id = $request->get_param( 'ticket_type_id' );
		$activity_ids   = $request->get_param( 'activity_ids' );
		$attended       = $request->get_param( 'attended' );

		if ( null === $ticket_type_id && null === $activity_ids && null === $attended ) {
			return new WP_Error(
				'missing_fields',
				__( 'Provide at least one of: ticket_type_id, activity_ids, attended.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$ticket = $this->find_ticket( (int) $request->get_param( 'event_date_id' ), (int) $request->get_param( 'ticket_id' ) );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}
		$ticket_id = (int) $ticket->id;

		if ( in_array( (string) $ticket->status, \FairEvents\Models\EventTicket::INACTIVE_STATUSES, true ) ) {
			return new WP_Error(
				'ticket_inactive',
				__( 'This ticket is no longer active.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		if ( 'confirmed' !== (string) $ticket->status ) {
			return new WP_Error(
				'ticket_awaiting_payment',
				__( 'This ticket is awaiting payment. It can be edited once the payment is complete.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		$has_rules    = class_exists( \FairEvents\Services\TicketEditRules::class );
		$current_type = $ticket->ticket_type_id ? \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id ) : null;
		$new_type     = $current_type;
		$type_changed = null !== $ticket_type_id && (int) $ticket_type_id !== (int) $ticket->ticket_type_id;

		if ( $type_changed ) {
			if ( ! $has_rules || ! $current_type ) {
				return new WP_Error(
					'ticket_type_not_changeable',
					__( 'This ticket’s type cannot be changed.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			$target_ids = array_map(
				static fn( $type ) => (int) $type->id,
				\FairEvents\Services\TicketEditRules::ticket_type_targets( (int) $ticket->event_date_id, $current_type )
			);
			if ( ! in_array( (int) $ticket_type_id, $target_ids, true ) ) {
				return new WP_Error(
					'invalid_ticket_type',
					__( 'The chosen ticket type is not available for this ticket.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			$new_type = \FairEvents\Models\TicketType::get_by_id( (int) $ticket_type_id );
		}

		$saved_ids = array_map( static fn( $row ) => (int) $row->ticket_option_id, $this->ticket_activity_rows( $ticket ) );
		$held_ids  = \FairEvents\Models\EventTicketActivity::get_active_option_ids( array( $ticket_id ) );

		$selected           = array();
		$activities_changed = false;
		if ( null !== $activity_ids ) {
			$catalogue = array();
			foreach ( $this->activity_catalogue( (int) $ticket->event_date_id ) as $option ) {
				$catalogue[ (int) $option->id ] = $option;
			}

			foreach ( array_unique( array_map( 'intval', (array) $activity_ids ) ) as $option_id ) {
				if ( ! isset( $catalogue[ $option_id ] ) ) {
					return new WP_Error(
						'invalid_ticket_option',
						__( 'One of the selected activities does not belong to this event.', 'fair-audience' ),
						array( 'status' => 400 )
					);
				}
				$selected[] = $catalogue[ $option_id ];
			}

			$selected_ids = array_map( static fn( $option ) => (int) $option->id, $selected );
			sort( $selected_ids );
			sort( $saved_ids );
			$activities_changed = $selected_ids !== $saved_ids;
		}

		// A ticket keeps an activity selection its type allows. Checked only
		// when the edit changes the type or the activities, so a check-in
		// never fails over a selection made under older rules.
		if ( $has_rules && ( $type_changed || $activities_changed ) ) {
			$rule_error = \FairEvents\Services\TicketEditRules::activity_count_error(
				$new_type,
				$activities_changed ? count( $selected ) : count( $held_ids )
			);
			if ( $rule_error ) {
				return $rule_error;
			}
		}

		$reason = null;
		if ( $request->has_param( 'override_reason' ) ) {
			$reason = trim( (string) $request->get_param( 'override_reason' ) );
			if ( '' === $reason ) {
				return new WP_Error(
					'override_reason_required',
					__( 'Enter a reason for going over capacity.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		$saved = $this->save_ticket(
			$ticket,
			array(
				'new_type'   => $type_changed ? $new_type : null,
				'activities' => $activities_changed ? $selected : null,
				'held_ids'   => $held_ids,
				'attended'   => null === $attended ? null : (bool) $attended,
			),
			$reason
		);
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}

		$ticket = \FairEvents\Models\EventTicket::get_by_id( $ticket_id );

		return rest_ensure_response(
			$this->build_ticket_payload(
				$ticket,
				$this->ticket_activity_rows( $ticket ),
				$this->get_ticket_answers( array( (int) $ticket->id ) )[ (int) $ticket->id ] ?? null
			)
		);
	}

	/**
	 * Write an administrator's edit of one ticket in one transaction, under
	 * fair-events' capacity lock. A new type needs a place of that type, and
	 * only activities the ticket does not already hold need a place, so
	 * saving an unchanged selection never asks for another one. Every limit
	 * the edit would go past is reported at once with a 409 carrying the
	 * projections, unless a reason is given: then the edit is saved, flagged
	 * over capacity and recorded in the override audit. A failed write rolls
	 * back the whole edit.
	 *
	 * @param object      $ticket  Ticket row.
	 * @param array       $changes new_type (TicketType|null), activities (TicketOption[]|null), held_ids (int[]), attended (bool|null).
	 * @param string|null $reason  Override reason, or null when none was given.
	 * @return true|WP_Error
	 */
	private function save_ticket( $ticket, array $changes, $reason ) {
		$ticket_id = (int) $ticket->id;
		$new_type  = $changes['new_type'];
		$selected  = $changes['activities'];
		$attended  = $changes['attended'];
		$failed    = new WP_Error(
			'update_failed',
			__( 'Failed to update the ticket.', 'fair-audience' ),
			array( 'status' => 500 )
		);

		$type_id = $new_type ? (int) $new_type->id : (int) $ticket->ticket_type_id;
		$added   = null === $selected ? array() : array_values(
			array_filter(
				$selected,
				static fn( $option ) => ! in_array( (int) $option->id, $changes['held_ids'], true )
			)
		);

		$demands = array();
		if ( $new_type ) {
			$demands[] = array(
				'event_date_id'  => (int) $ticket->event_date_id,
				'ticket_type_id' => $type_id,
				'quantity'       => 1,
			);
		}
		$activity_demand = array(
			'event_date_id'  => (int) $ticket->event_date_id,
			'ticket_type_id' => $type_id,
			'quantity'       => 0,
			'option_ids'     => array_map( static fn( $option ) => (int) $option->id, $added ),
		);
		if ( $added ) {
			$demands[] = $activity_demand;
		}

		return \FairEvents\Services\TicketCapacity::with_capacity_lock(
			$demands,
			static function () use ( $ticket, $ticket_id, $new_type, $selected, $added, $attended, $activity_demand, $reason, $failed ) {
				$exceeding = array();
				if ( $new_type ) {
					$projection = \FairEvents\Services\TicketCapacity::projection( 'ticket_type', (int) $new_type->id, 1 );
					if ( ! $projection ) {
						return $failed;
					}
					if ( \FairEvents\Services\TicketCapacity::projection_exceeds( $projection ) ) {
						$exceeding[] = $projection;
					}
				}
				if ( $added && method_exists( \FairEvents\Services\TicketCapacity::class, 'activity_projections' ) ) {
					foreach ( \FairEvents\Services\TicketCapacity::activity_projections( array( $activity_demand ) ) as $projection ) {
						if ( \FairEvents\Services\TicketCapacity::projection_exceeds( $projection ) ) {
							$exceeding[] = $projection;
						}
					}
				}

				if ( $exceeding && null === $reason ) {
					return new WP_Error(
						'capacity_exceeded',
						sprintf(
							/* translators: 1: ticket type or activity name, 2: places taken after the change, 3: capacity */
							_n(
								'%1$s would have %2$d of %3$d place taken.',
								'%1$s would have %2$d of %3$d places taken.',
								(int) $exceeding[0]['capacity'],
								'fair-audience'
							),
							$exceeding[0]['label'],
							$exceeding[0]['after'],
							$exceeding[0]['capacity']
						),
						array(
							'status'      => 409,
							'projection'  => $exceeding[0],
							'projections' => $exceeding,
						)
					);
				}

				if ( $new_type && ! \FairEvents\Models\EventTicket::set_ticket_type( $ticket_id, (int) $new_type->id ) ) {
					return $failed;
				}

				// Newly added activities are confirmed, including one whose
				// earlier add-on hold had lapsed; kept ones keep their status.
				if ( null !== $selected
					&& ( ! \FairEvents\Models\EventTicketActivity::replace_for_ticket( $ticket_id, $selected )
						|| ! \FairEvents\Models\EventTicketActivity::confirm( $ticket_id, $added ) )
				) {
					return $failed;
				}

				if ( null !== $attended && ! \FairEvents\Models\EventTicket::set_attended( $ticket_id, $attended ) ) {
					return $failed;
				}

				foreach ( $exceeding as $exceeded ) {
					$is_activity = 'ticket_option' === $exceeded['scope'];
					if ( $is_activity ) {
						\FairEvents\Models\EventTicketActivity::mark_over_capacity( $ticket_id, array( (int) $exceeded['id'] ) );
					}
					\FairEvents\Models\EventSignup::mark_over_capacity( (int) $ticket->signup_id );

					$recorded = \FairEvents\Models\EventCapacityOverride::create(
						array(
							'signup_id'           => (int) $ticket->signup_id,
							'action'              => $is_activity ? 'activity' : 'change_type',
							'from_event_date_id'  => (int) $ticket->event_date_id,
							'to_event_date_id'    => $is_activity ? (int) $exceeded['event_date_id'] : (int) $ticket->event_date_id,
							'from_ticket_type_id' => (int) $ticket->ticket_type_id,
							'to_ticket_type_id'   => $new_type ? (int) $new_type->id : (int) $ticket->ticket_type_id,
							'ticket_id'           => $ticket_id,
							'ticket_option_id'    => $is_activity ? (int) $exceeded['id'] : 0,
							'ticket_option_name'  => $is_activity ? $exceeded['label'] : '',
							'ticket_count'        => $is_activity ? (int) $exceeded['after'] - (int) $exceeded['taken'] : 1,
							'taken'               => (int) $exceeded['taken'],
							'capacity'            => (int) $exceeded['capacity'],
							'reason'              => $reason,
							'user_id'             => get_current_user_id(),
						)
					);
					if ( ! $recorded ) {
						return $failed;
					}
				}

				return true;
			}
		);
	}

	/**
	 * Give one ticket to another participant: an existing one, or one
	 * created from the given details in the same step. Only the ticket's
	 * holder changes. Its purchaser, signup, payment, type, activities and
	 * answers, and the purchase's other tickets, stay as they are. The new
	 * holder gets a relationship on the event date when they have none, so
	 * they are listed in the audience; an existing relationship, and the
	 * previous holder's, are left untouched. Creating the participant, the
	 * relationship and the change of holder share one transaction.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function assign_ticket( $request ) {
		$participant_id = (int) $request->get_param( 'participant_id' );
		$details        = $request->get_param( 'participant' );
		$has_details    = is_array( $details ) && $details;

		if ( ( $participant_id > 0 ) === (bool) $has_details ) {
			return new WP_Error(
				'invalid_assignee',
				__( 'Choose an existing participant or enter the details of a new one.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$ticket = $this->find_ticket( (int) $request->get_param( 'event_date_id' ), (int) $request->get_param( 'ticket_id' ) );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		if ( ! method_exists( \FairEvents\Models\EventTicket::class, 'set_holder' ) ) {
			return new WP_Error(
				'fair_events_unavailable',
				__( 'Update Fair Events to assign tickets.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		$refusal = $this->assignment_refusal( $ticket );
		if ( $refusal ) {
			return $refusal;
		}

		if ( $participant_id ) {
			$participant = $this->participant_repo->get_by_id( $participant_id );
			if ( ! $participant ) {
				return new WP_Error(
					'invalid_participant',
					__( 'Participant not found.', 'fair-audience' ),
					array( 'status' => 404 )
				);
			}
		} else {
			$participant = $this->new_assignee( $details );
			if ( is_wp_error( $participant ) ) {
				return $participant;
			}
		}

		$saved = $this->save_assignment( $ticket, $participant );
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}

		$ticket = \FairEvents\Models\EventTicket::get_by_id( (int) $ticket->id );

		return rest_ensure_response(
			$this->build_ticket_payload(
				$ticket,
				$this->ticket_activity_rows( $ticket ),
				$this->get_ticket_answers( array( (int) $ticket->id ) )[ (int) $ticket->id ] ?? null
			)
		);
	}

	/**
	 * Why a ticket cannot be given to someone else, if it cannot. A ticket
	 * that no longer admits anyone, or whose payment window has lapsed,
	 * stays with its holder. A checked-in ticket records that its holder
	 * arrived, so the check-in has to be cleared first.
	 *
	 * @param object $ticket Ticket row.
	 * @return WP_Error|null
	 */
	private function assignment_refusal( $ticket ) {
		if ( in_array( (string) $ticket->status, \FairEvents\Models\EventTicket::INACTIVE_STATUSES, true ) ) {
			return new WP_Error(
				'ticket_inactive',
				__( 'This ticket is no longer active.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		if ( 'confirmed' !== (string) $ticket->status ) {
			$signup = \FairEvents\Models\EventSignup::get_by_id( (int) $ticket->signup_id );
			if ( $signup && ! empty( $signup->payment_expires_at ) && strtotime( $signup->payment_expires_at . ' UTC' ) <= time() ) {
				return new WP_Error(
					'ticket_payment_expired',
					__( 'The payment for this ticket was not completed in time, so it cannot be assigned.', 'fair-audience' ),
					array( 'status' => 409 )
				);
			}
		}

		if ( ! empty( $ticket->attended_at ) ) {
			return new WP_Error(
				'ticket_checked_in',
				__( 'This ticket is checked in. Clear the check-in before assigning the ticket to someone else.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return null;
	}

	/**
	 * Build, without saving, the participant a ticket is to be assigned to
	 * from the details an administrator entered. A name is required. An
	 * email is optional, has to be valid, and must not belong to an existing
	 * participant: that identity is offered instead of creating a second
	 * one. The participant starts on the minimal email profile; marketing
	 * consent is recorded through its own flow.
	 *
	 * @param array $details name, surname, email.
	 * @return \FairAudience\Models\Participant|WP_Error
	 */
	private function new_assignee( array $details ) {
		$name  = trim( sanitize_text_field( (string) ( $details['name'] ?? '' ) ) );
		$email = trim( (string) ( $details['email'] ?? '' ) );

		if ( '' === $name ) {
			return new WP_Error(
				'participant_name_required',
				__( 'Enter the new participant’s name.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( '' !== $email ) {
			if ( ! is_email( $email ) ) {
				return new WP_Error(
					'invalid_email',
					__( 'Enter a valid email address.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			$email    = sanitize_email( $email );
			$existing = $this->participant_repo->get_by_email( $email );
			if ( $existing ) {
				return $this->email_exists_error( $existing );
			}
		}

		return new \FairAudience\Models\Participant(
			array(
				'name'    => $name,
				'surname' => (string) ( $details['surname'] ?? '' ),
				'email'   => $email,
			)
		);
	}

	/**
	 * The refusal to create a participant whose email an existing one
	 * already uses, naming that participant so they can be chosen instead.
	 *
	 * @param \FairAudience\Models\Participant $existing Participant using the email.
	 * @return WP_Error
	 */
	private function email_exists_error( $existing ) {
		return new WP_Error(
			'email_exists',
			__( 'A participant with this email already exists.', 'fair-audience' ),
			array(
				'status'      => 409,
				'participant' => $this->ticket_person( (int) $existing->id ),
			)
		);
	}

	/**
	 * Write an assignment in one transaction: create the participant when
	 * they are new, make sure they have a relationship on the ticket's
	 * event date, and make them the ticket's holder. The ticket is checked
	 * again under a row lock, so a check-in or status change made meanwhile
	 * is not overwritten. A failed step rolls back all of them, so no
	 * participant is left behind without the ticket.
	 *
	 * @param object                           $ticket      Ticket row.
	 * @param \FairAudience\Models\Participant $participant New holder; saved here when not saved yet.
	 * @return true|WP_Error
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	private function save_assignment( $ticket, $participant ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query( 'START TRANSACTION' );

		try {
			$result = $this->write_assignment( $ticket, $participant );
		} catch ( \Throwable $e ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
			throw $e;
		}

		if ( is_wp_error( $result ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'ROLLBACK' );
		} else {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( 'COMMIT' );
		}

		return $result;
	}

	/**
	 * The writes of save_assignment(), run inside its transaction.
	 *
	 * @param object                           $ticket      Ticket row.
	 * @param \FairAudience\Models\Participant $participant New holder; saved here when not saved yet.
	 * @return true|WP_Error
	 */
	private function write_assignment( $ticket, $participant ) {
		global $wpdb;

		$failed = new WP_Error(
			'assignment_failed',
			__( 'Failed to assign the ticket.', 'fair-audience' ),
			array( 'status' => 500 )
		);

		$locked = \FairEvents\Models\EventTicket::get_for_update( (int) $ticket->id );
		if ( ! $locked || (int) $locked->event_date_id !== (int) $ticket->event_date_id ) {
			return new WP_Error(
				'ticket_not_found',
				__( 'Ticket not found for this event date.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$refusal = $this->assignment_refusal( $locked );
		if ( $refusal ) {
			return $refusal;
		}

		if ( ! $participant->id ) {
			// The email's unique key refuses a participant created with the
			// same email since it was checked.
			$suppressed = $wpdb->suppress_errors( true );
			$created    = $participant->save() && $participant->id;
			$wpdb->suppress_errors( $suppressed );

			if ( ! $created ) {
				$existing = $participant->email ? $this->participant_repo->get_by_email( $participant->email ) : null;

				return $existing ? $this->email_exists_error( $existing ) : $failed;
			}
		}

		if ( ! $this->event_participant_repo->ensure_ticket_holder_relationship( (int) $locked->event_date_id, (int) $participant->id ) ) {
			return $failed;
		}

		if ( (int) $locked->holder_participant_id !== (int) $participant->id
			&& ! \FairEvents\Models\EventTicket::set_holder( (int) $locked->id, (int) $participant->id )
		) {
			return $failed;
		}

		return true;
	}

	/**
	 * Move one ticket to another date of its recurring event, leaving the
	 * purchase's other tickets, the signup and its payment where they are.
	 * The ticket keeps its type, activities, answers, check-in, purchaser
	 * and holder; its holder is admitted on the target date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function move_ticket( $request ) {
		$ticket = $this->find_operable_ticket( $request );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		$reason = null;
		if ( $request->has_param( 'override_reason' ) ) {
			$reason = trim( (string) $request->get_param( 'override_reason' ) );
			if ( '' === $reason ) {
				return new WP_Error(
					'override_reason_required',
					__( 'Enter a reason for going over capacity.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		$moved = ( new TicketOperations( $this->event_participant_repo ) )->move( $ticket, (int) $request->get_param( 'target_event_date_id' ), $reason );
		if ( is_wp_error( $moved ) ) {
			return $moved;
		}

		return $this->ticket_response( (int) $ticket->id );
	}

	/**
	 * Cancel one ticket, leaving the purchase's other tickets, the signup
	 * and its payment as they are. Nothing is refunded.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function cancel_ticket( $request ) {
		$ticket = $this->find_operable_ticket( $request );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		$cancelled = ( new TicketOperations( $this->event_participant_repo ) )->cancel( $ticket );
		if ( is_wp_error( $cancelled ) ) {
			return $cancelled;
		}

		return $this->ticket_response( (int) $ticket->id );
	}

	/**
	 * Delete one cancelled ticket: it is no longer listed, searched or
	 * exported, while its record stays with the purchase.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_ticket( $request ) {
		$ticket = $this->find_operable_ticket( $request );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		$deleted = ( new TicketOperations( $this->event_participant_repo ) )->delete( $ticket );
		if ( is_wp_error( $deleted ) ) {
			return $deleted;
		}

		return rest_ensure_response(
			array(
				'deleted' => true,
				'id'      => (int) $ticket->id,
			)
		);
	}

	/**
	 * Find the ticket a move, cancellation or deletion names, once
	 * fair-events can do those.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return object|WP_Error Ticket row, a 404, or a 500 when fair-events is too old.
	 */
	private function find_operable_ticket( $request ) {
		$ticket = $this->find_ticket( (int) $request->get_param( 'event_date_id' ), (int) $request->get_param( 'ticket_id' ) );
		if ( is_wp_error( $ticket ) ) {
			return $ticket;
		}

		if ( ! TicketOperations::available() ) {
			return new WP_Error(
				'fair_events_unavailable',
				__( 'Update Fair Events to move, cancel or delete tickets.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return $ticket;
	}

	/**
	 * One ticket as it is now, shaped for the Audience tab.
	 *
	 * @param int $ticket_id Ticket ID.
	 * @return WP_REST_Response
	 */
	private function ticket_response( $ticket_id ) {
		$ticket = \FairEvents\Models\EventTicket::get_by_id( $ticket_id );

		return rest_ensure_response(
			$this->build_ticket_payload(
				$ticket,
				$this->ticket_activity_rows( $ticket ),
				$this->get_ticket_answers( array( $ticket_id ) )[ $ticket_id ] ?? null
			)
		);
	}

	/**
	 * Find a ticket on an event date. A deleted ticket is not found.
	 *
	 * @param int $event_date_id Event date the ticket must be on.
	 * @param int $ticket_id     Ticket ID.
	 * @return object|WP_Error Ticket row, or a 404.
	 */
	private function find_ticket( $event_date_id, $ticket_id ) {
		$ticket = TicketActivities::available() ? \FairEvents\Models\EventTicket::get_by_id( $ticket_id ) : null;
		if ( ! $ticket || (int) $ticket->event_date_id !== $event_date_id || ! empty( $ticket->deleted_at ) ) {
			return new WP_Error(
				'ticket_not_found',
				__( 'Ticket not found for this event date.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return $ticket;
	}

	/**
	 * The activities configured for an event date, from its series master
	 * for a generated occurrence.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return object[] TicketOption objects.
	 */
	private function activity_catalogue( $event_date_id ) {
		if ( ! class_exists( \FairEvents\Models\TicketOption::class ) ) {
			return array();
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( $event_date && 'generated' === $event_date->occurrence_type && $event_date->master_id ) {
			$event_date_id = (int) $event_date->master_id;
		}

		return \FairEvents\Models\TicketOption::get_all_by_event_date_id( $event_date_id );
	}

	/**
	 * One ticket's activity rows, shaped for build_ticket_payload().
	 *
	 * @param object $ticket Ticket row.
	 * @return object[]
	 */
	private function ticket_activity_rows( $ticket ) {
		$ticket_id = (int) $ticket->id;
		$rows      = array();
		foreach ( \FairEvents\Models\EventTicketActivity::get_by_ticket_ids( array( $ticket_id ) )[ $ticket_id ] ?? array() as $activity ) {
			$rows[] = (object) array(
				'ticket_option_id'   => (int) $activity->ticket_option_id,
				'ticket_option_name' => (string) $activity->ticket_option_name,
				'status'             => 'confirmed' === $ticket->status ? (string) $activity->status : 'pending_payment',
				'ticket_id'          => $ticket_id,
				'over_capacity'      => ! empty( $activity->over_capacity ),
			);
		}

		return $rows;
	}

	/**
	 * Shape one ticket for the Audience tab.
	 *
	 * @param object     $ticket        Ticket row.
	 * @param object[]   $activity_rows Activity rows of the ticket's holder; only this ticket's are used.
	 * @param array|null $answers       The ticket's Fair Form answers (a TicketAnswers::for_tickets() entry), or null for none.
	 * @return array
	 */
	private function build_ticket_payload( $ticket, array $activity_rows, $answers = null ) {
		$ticket_type_name = null;
		$whole_series     = false;
		if ( ! empty( $ticket->ticket_type_id ) && class_exists( \FairEvents\Models\TicketType::class ) ) {
			$ticket_type      = \FairEvents\Models\TicketType::get_by_id( (int) $ticket->ticket_type_id );
			$ticket_type_name = $ticket_type ? $ticket_type->name : null;
			$whole_series     = $ticket_type && $ticket_type->is_whole_series();
		}

		$activity_ids               = array();
		$activity_names             = array();
		$confirmed_activity_ids     = array();
		$over_capacity_activity_ids = array();
		foreach ( $activity_rows as $row ) {
			if ( (int) $row->ticket_id !== (int) $ticket->id ) {
				continue;
			}
			$activity_ids[]   = (int) $row->ticket_option_id;
			$activity_names[] = (string) $row->ticket_option_name;
			if ( 'confirmed' === $row->status ) {
				$confirmed_activity_ids[] = (int) $row->ticket_option_id;
			}
			if ( ! empty( $row->over_capacity ) ) {
				$over_capacity_activity_ids[] = (int) $row->ticket_option_id;
			}
		}

		// A ticket nobody was given yet is its purchaser's.
		$purchaser = $this->ticket_purchaser( $ticket );
		$assignee  = $this->ticket_person( $ticket->holder_participant_id ?? 0 ) ?? $purchaser;

		return array(
			'id'                         => (int) $ticket->id,
			'position'                   => (int) $ticket->unit_position,
			'reference'                  => strtoupper( substr( (string) $ticket->reference, 0, 8 ) ),
			'signup_id'                  => (int) $ticket->signup_id,
			'event_date_id'              => (int) $ticket->event_date_id,
			// A whole-series pass covers every date, so it has none to move to.
			'whole_series'               => $whole_series,
			'ticket_type_id'             => $ticket->ticket_type_id ? (int) $ticket->ticket_type_id : null,
			'ticket_type_name'           => $ticket_type_name,
			'status'                     => (string) $ticket->status,
			'attended_at'                => $ticket->attended_at,
			'activity_ids'               => $activity_ids,
			'activity_names'             => $activity_names,
			'confirmed_activity_ids'     => $confirmed_activity_ids,
			'over_capacity_activity_ids' => $over_capacity_activity_ids,
			'answers'                    => $answers ? $answers['answers'] : array(),
			'answers_need_review'        => $answers ? (bool) $answers['needs_review'] : false,
			'purchaser'                  => $purchaser,
			'assignee'                   => $assignee,
		);
	}

	/**
	 * A participant's ID, name and email, as shown for a ticket's purchaser
	 * and assignee.
	 *
	 * @param int $participant_id Participant ID.
	 * @return array|null Null for no participant, or one that no longer exists.
	 */
	private function ticket_person( $participant_id ) {
		$participant_id = (int) $participant_id;
		if ( ! $participant_id ) {
			return null;
		}

		if ( ! isset( $this->ticket_people[ $participant_id ] ) ) {
			$participant                            = $this->participant_repo->get_by_id( $participant_id );
			$this->ticket_people[ $participant_id ] = $participant
				? array(
					'participant_id' => (int) $participant->id,
					'name'           => trim( $participant->name . ' ' . $participant->surname ),
					'email'          => (string) $participant->email,
				)
				: false;
		}

		return $this->ticket_people[ $participant_id ] ? $this->ticket_people[ $participant_id ] : null;
	}

	/**
	 * Who bought a ticket: the participant its purchaser link names, else
	 * the one its signup names, else the name and email the signup was made
	 * with (records from before purchasers were linked).
	 *
	 * @param object $ticket Ticket row.
	 * @return array participant_id (null when no participant is linked), name, email.
	 */
	private function ticket_purchaser( $ticket ) {
		$purchaser = $this->ticket_person( $ticket->purchaser_participant_id ?? 0 );
		if ( $purchaser ) {
			return $purchaser;
		}

		$signup    = \FairEvents\Models\EventSignup::get_by_id( (int) $ticket->signup_id );
		$purchaser = $signup ? $this->ticket_person( $signup->participant_id ?? 0 ) : null;
		if ( $purchaser ) {
			return $purchaser;
		}

		return array(
			'participant_id' => null,
			'name'           => $signup ? (string) $signup->name : '',
			'email'          => $signup ? (string) $signup->email : '',
		);
	}

	/**
	 * Remove participant from event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$event_date_id  = $request->get_param( 'event_date_id' );
		$participant_id = $request->get_param( 'participant_id' );

		$success = $this->event_participant_repo->remove_participant_from_event_date( $event_date_id, $participant_id );

		if ( ! $success ) {
			return new WP_Error(
				'deletion_failed',
				__( 'Failed to remove participant.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Participant removed successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Move a participant's signup to a sibling occurrence of the same
	 * recurring event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function move_item( $request ) {
		$event_date_id        = (int) $request->get_param( 'event_date_id' );
		$participant_id       = (int) $request->get_param( 'participant_id' );
		$target_event_date_id = (int) $request->get_param( 'target_event_date_id' );

		if ( ! class_exists( \FairEvents\Models\EventDates::class ) ) {
			return new WP_Error(
				'fair_events_unavailable',
				__( 'The fair-events plugin is required for this action.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$master_id = ( 'generated' === $event_date->occurrence_type && $event_date->master_id )
			? $event_date->master_id
			: $event_date->id;

		$sibling_ids = wp_list_pluck( \FairEvents\Models\EventDates::get_all_by_master_id( $master_id ), 'id' );

		if ( ! in_array( $target_event_date_id, $sibling_ids, true ) ) {
			return new WP_Error(
				'invalid_target',
				__( 'The target date is not another occurrence of this recurring event.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$result = $this->event_participant_repo->move_to_event_date( $event_date_id, $participant_id, $target_event_date_id );

		if ( 'not_found' === $result ) {
			return new WP_Error(
				'not_found',
				__( 'Signup not found on this event date.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( 'conflict' === $result ) {
			return new WP_Error(
				'already_signed_up',
				__( 'This participant is already signed up on the target date.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return rest_ensure_response(
			array(
				'message'              => __( 'Signup moved successfully.', 'fair-audience' ),
				'target_event_date_id' => $target_event_date_id,
			)
		);
	}

	/**
	 * Delete multiple participants from an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_batch_items( $request ) {
		$event_date_id   = (int) $request['event_date_id'];
		$participant_ids = $request->get_param( 'participant_ids' );

		// Resolve event_id from event_date_id.
		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date->event_id;

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Invalid event ID.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$results = array(
			'removed' => 0,
			'failed'  => 0,
			'errors'  => array(),
		);

		foreach ( $participant_ids as $participant_id ) {
			$participant_id = (int) $participant_id;

			$deleted = $this->event_participant_repo->remove_participant_from_event_date(
				$event_date_id,
				$participant_id
			);

			if ( $deleted ) {
				++$results['removed'];
			} else {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Failed to remove participant ID %d', 'fair-audience' ),
					$participant_id
				);
			}
		}

		return rest_ensure_response( $results );
	}

	/**
	 * Add multiple participants to an event with the same label.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_batch_items( $request ) {
		$event_date_id   = (int) $request['event_date_id'];
		$participant_ids = $request->get_param( 'participant_ids' );
		$label           = $request->get_param( 'label' );

		// Resolve event_id from event_date_id.
		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date->event_id;

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Invalid event ID.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$results = array(
			'added'   => 0,
			'skipped' => 0,
			'failed'  => 0,
			'errors'  => array(),
		);

		foreach ( $participant_ids as $participant_id ) {
			$participant_id = (int) $participant_id;

			// Verify participant exists.
			$participant = $this->participant_repo->get_by_id( $participant_id );
			if ( ! $participant ) {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Participant ID %d not found', 'fair-audience' ),
					$participant_id
				);
				continue;
			}

			$id = $this->event_participant_repo->add_participant_to_event(
				$event_id,
				$participant_id,
				$label,
				$event_date_id
			);

			if ( false === $id ) {
				// Already exists.
				++$results['skipped'];
			} else {
				++$results['added'];
			}
		}

		return rest_ensure_response( $results );
	}

	/**
	 * Record email consent for selected participants at an event.
	 *
	 * Handles two directions in one request:
	 * - marketing_ids: flip minimal → marketing, write audit row, send welcome email.
	 * - declined_ids:  flip minimal → declined, write audit row, no email.
	 *
	 * Participants already on marketing or declined are skipped automatically
	 * because both paths require email_profile === 'minimal'. An already-declined
	 * participant passed in marketing_ids is therefore never silently re-upgraded.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function record_marketing_consent_batch( $request ) {
		$event_date_id = (int) $request['event_date_id'];
		$marketing_ids = array_map( 'intval', (array) $request->get_param( 'marketing_ids' ) );
		$declined_ids  = array_map( 'intval', (array) $request->get_param( 'declined_ids' ) );

		// Resolve event_id from event_date_id.
		$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date->event_id;

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Invalid event ID.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$results = array(
			'upgraded'     => 0,
			'declined'     => 0,
			'skipped'      => 0,
			'failed'       => 0,
			'emailed'      => 0,
			'email_failed' => 0,
			'errors'       => array(),
		);

		$email_service = new EmailService();

		$performed_by = get_current_user_id();
		$admin_user   = get_userdata( $performed_by );
		$admin_name   = $admin_user ? $admin_user->display_name : '';
		$event_title  = get_the_title( $event_id );
		$today        = gmdate( 'Y-m-d' );

		// Process marketing upgrades (minimal → marketing).
		foreach ( $marketing_ids as $participant_id ) {
			$participant = $this->participant_repo->get_by_id( $participant_id );
			if ( ! $participant ) {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Participant ID %d not found', 'fair-audience' ),
					$participant_id
				);
				continue;
			}

			$ep_row = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( ! $ep_row ) {
				++$results['skipped'];
				continue;
			}

			// Skip participants without an email or not on minimal
			// (guarantees we never re-email an already-subscribed person and
			// never upgrade a declined participant by mistake).
			if ( empty( $participant->email ) || 'minimal' !== $participant->email_profile ) {
				++$results['skipped'];
				continue;
			}

			$old_profile                = $participant->email_profile;
			$participant->email_profile = 'marketing';

			if ( ! $participant->save() ) {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Failed to upgrade participant ID %d', 'fair-audience' ),
					$participant_id
				);
				continue;
			}

			++$results['upgraded'];

			EmailConsentLog::create(
				array(
					'participant_id' => $participant_id,
					'event_id'       => $event_id,
					'event_date_id'  => $event_date_id,
					'old_profile'    => $old_profile,
					'new_profile'    => 'marketing',
					'source'         => 'verbal_admin',
					'comment'        => sprintf(
						/* translators: 1: admin display name, 2: date, 3: event title */
						__( 'Verbal consent recorded by %1$s on %2$s at event %3$s', 'fair-audience' ),
						$admin_name,
						$today,
						$event_title
					),
					'performed_by'   => $performed_by,
				)
			);

			// Welcome email (single opt-in: they already consented in person).
			if ( $email_service->send_mailing_list_welcome( $participant, $event_id ) ) {
				++$results['emailed'];
			} else {
				++$results['email_failed'];
			}
		}

		// Process declines (minimal → declined).
		foreach ( $declined_ids as $participant_id ) {
			$participant = $this->participant_repo->get_by_id( $participant_id );
			if ( ! $participant ) {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Participant ID %d not found', 'fair-audience' ),
					$participant_id
				);
				continue;
			}

			$ep_row = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( ! $ep_row ) {
				++$results['skipped'];
				continue;
			}

			// Only act on minimal — never silently flip a marketing subscriber.
			if ( 'minimal' !== $participant->email_profile ) {
				++$results['skipped'];
				continue;
			}

			$old_profile                = $participant->email_profile;
			$participant->email_profile = 'declined';

			if ( ! $participant->save() ) {
				++$results['failed'];
				$results['errors'][] = sprintf(
					/* translators: %d: participant ID */
					__( 'Failed to record decline for participant ID %d', 'fair-audience' ),
					$participant_id
				);
				continue;
			}

			++$results['declined'];

			EmailConsentLog::create(
				array(
					'participant_id' => $participant_id,
					'event_id'       => $event_id,
					'event_date_id'  => $event_date_id,
					'old_profile'    => $old_profile,
					'new_profile'    => 'declined',
					'source'         => 'verbal_admin',
					'comment'        => sprintf(
						/* translators: 1: admin display name, 2: date, 3: event title */
						__( 'Decline recorded by %1$s on %2$s at event %3$s', 'fair-audience' ),
						$admin_name,
						$today,
						$event_title
					),
					'performed_by'   => $performed_by,
				)
			);
		}

		return rest_ensure_response( $results );
	}

	/**
	 * Get all events with participant counts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_events( $request ) {
		$per_page = $request->get_param( 'per_page' );
		$page     = $request->get_param( 'page' );
		$orderby  = $request->get_param( 'orderby' );
		$order    = strtoupper( $request->get_param( 'order' ) );
		$search   = $request->get_param( 'search' );

		// Build base query args.
		$query_args = array(
			'post_type'      => \FairEvents\Settings\Settings::get_enabled_post_types(),
			'post_status'    => 'publish',
			'posts_per_page' => $per_page,
			'paged'          => $page,
		);

		// Handle search.
		if ( ! empty( $search ) ) {
			$query_args['s'] = $search;
		}

		// Handle sorting for title only - other fields need PHP sorting.
		if ( 'title' === $orderby ) {
			$query_args['orderby'] = 'title';
			$query_args['order']   = $order;
		} else {
			// For event_date and participants - fetch all and sort in PHP.
			// We can't use meta_key for event_date as it would exclude events without that meta.
			$query_args['posts_per_page'] = -1;
			$query_args['orderby']        = 'date';
			$query_args['order']          = 'DESC';
		}

		// Execute query.
		$query = new \WP_Query( $query_args );

		$items = array();
		foreach ( $query->posts as $event ) {
			// Resolve event_date_id from fair_event_dates table.
			$event_date_id = null;
			if ( class_exists( '\FairEvents\Models\EventDates' ) ) {
				$event_dates_obj = \FairEvents\Models\EventDates::get_by_event_id( $event->ID );
				if ( $event_dates_obj ) {
					$event_date_id = (int) $event_dates_obj->id;
				}
			}

			$counts = $event_date_id
				? $this->event_participant_repo->get_label_counts_for_event_date( $event_date_id )
				: $this->event_participant_repo->get_label_counts_for_event( $event->ID );

			// Get event date metadata (from fair-events plugin).
			// Try event_start first, fall back to event_date for compatibility.
			$event_date = get_post_meta( $event->ID, 'event_start', true );
			if ( empty( $event_date ) ) {
				$event_date = get_post_meta( $event->ID, 'event_date', true );
			}

			// Calculate total participants (signed_up + collaborator).
			$participants = ( $counts['signed_up'] ?? 0 ) + ( $counts['collaborator'] ?? 0 );

			$items[] = array(
				'event_id'           => $event->ID,
				'event_date_id'      => $event_date_id,
				'title'              => $event->post_title,
				'link'               => get_permalink( $event->ID ),
				'event_date'         => $event_date,
				'participant_counts' => $counts,
				'participants'       => $participants,
			);
		}

		// Handle sorting by computed fields (all except title which uses WP_Query).
		if ( 'title' !== $orderby ) {
			$sort_key = $orderby;

			usort(
				$items,
				function ( $a, $b ) use ( $sort_key, $order ) {
					if ( 'event_date' === $sort_key ) {
						// Sort by date string (works for ISO format dates).
						$val_a = $a['event_date'] ?? '';
						$val_b = $b['event_date'] ?? '';
						$diff  = strcmp( $val_a, $val_b );
					} else {
						$diff = ( $a[ $sort_key ] ?? 0 ) - ( $b[ $sort_key ] ?? 0 );
					}
					return 'DESC' === $order ? -$diff : $diff;
				}
			);

			// Apply pagination manually.
			$total_items = count( $items );
			$total_pages = (int) ceil( $total_items / $per_page );
			$offset      = ( $page - 1 ) * $per_page;
			$items       = array_slice( $items, $offset, $per_page );
		} else {
			$total_items = $query->found_posts;
			$total_pages = $query->max_num_pages;
		}

		$response = rest_ensure_response( $items );
		$response->header( 'X-WP-Total', $total_items );
		$response->header( 'X-WP-TotalPages', $total_pages );

		return $response;
	}

	/**
	 * Get single event info for header display.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_event( $request ) {
		$event_date_id = $request->get_param( 'event_date_id' );

		// Resolve event_id from event_date_id.
		$event_date_obj = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
		if ( ! $event_date_obj ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}
		$event_id = (int) $event_date_obj->event_id;

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Get event date metadata. Prefer the authoritative start_datetime from
		// the fair_event_dates row; fall back to legacy post meta for events
		// whose meta predates the event-dates table.
		$event_date = $event_date_obj->start_datetime;
		if ( empty( $event_date ) ) {
			$event_date = get_post_meta( $event_id, 'event_start', true );
		}
		if ( empty( $event_date ) ) {
			$event_date = get_post_meta( $event_id, 'event_date', true );
		}

		// Get participant counts by label.
		$counts = $this->event_participant_repo->get_label_counts_for_event_date( $event_date_id );

		$signed_up     = ( $counts['signed_up'] ?? 0 ) + ( $counts['interested'] ?? 0 );
		$collaborators = $counts['collaborator'] ?? 0;
		$interested    = $counts['interested'] ?? 0;

		$response_data = array(
			'event_id'         => $event_id,
			'event_date_id'    => $event_date_id,
			'title'            => $event->post_title,
			'link'             => get_permalink( $event_id ),
			'edit_url'         => get_edit_post_link( $event_id, 'raw' ),
			'event_date'       => $event_date,
			'signed_up'        => $signed_up,
			'collaborators'    => $collaborators,
			'interested'       => $interested,
			'manage_event_url' => admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . $event_date_id ),
		);

		return rest_ensure_response( $response_data );
	}

	/**
	 * Check permissions for creating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for deleting.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for moving a signup to another occurrence.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function move_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
