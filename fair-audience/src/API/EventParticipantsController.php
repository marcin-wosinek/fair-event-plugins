<?php
/**
 * Event Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\QuestionnaireAnswerRepository;
use FairAudience\Models\EmailConsentLog;
use FairAudience\Services\EmailService;
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

		// POST /fair-audience/v1/event-dates/{event_date_id}/participants/marketing-upgrade.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/marketing-upgrade',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'upgrade_to_marketing_batch' ),
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
						'enum'    => array( 'title', 'event_date', 'participants', 'images', 'likes' ),
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

		// Build participant → ticket option names + IDs lookup from junction table.
		$participant_option_names = array();
		$participant_option_ids   = array();
		$ep_ids                   = array_map( fn( $ep ) => $ep->id, $event_participants );
		if ( ! empty( $ep_ids ) ) {
			$placeholders = implode( ',', array_fill( 0, count( $ep_ids ), '%d' ) );
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
			$option_rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT event_participant_id, ticket_option_id, ticket_option_name
					FROM {$wpdb->prefix}fair_audience_event_participant_options
					WHERE event_participant_id IN ($placeholders)",
					...$ep_ids
				)
			);
			foreach ( $option_rows as $row ) {
				$ep_id = (int) $row->event_participant_id;
				if ( ! isset( $participant_option_names[ $ep_id ] ) ) {
					$participant_option_names[ $ep_id ] = array();
					$participant_option_ids[ $ep_id ]   = array();
				}
				if ( '' !== (string) $row->ticket_option_name ) {
					$participant_option_names[ $ep_id ][] = $row->ticket_option_name;
				}
				if ( $row->ticket_option_id ) {
					$participant_option_ids[ $ep_id ][] = (int) $row->ticket_option_id;
				}
			}
		}

		// Get likes received per participant (for photos they authored).
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$likes_data = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT pp.participant_id, COUNT(pl.id) as likes_count
				FROM {$wpdb->prefix}fair_audience_photo_participants pp
				INNER JOIN {$wpdb->prefix}fair_events_event_photos ep
					ON pp.attachment_id = ep.attachment_id AND ep.event_id = %d
				LEFT JOIN {$wpdb->prefix}fair_events_photo_likes pl
					ON pp.attachment_id = pl.attachment_id
				WHERE pp.role = 'author'
				GROUP BY pp.participant_id",
				$event_id
			),
			OBJECT_K
		);

		// Custom question answers captured during signup (Event Signup block).
		// Stored as questionnaire submissions keyed by participant + event date,
		// indexed here so each signup row can carry its answers inline.
		$participant_questionnaire = $this->get_signup_answers_by_participant( $event_date_id );

		$items = array_map(
			function ( $ep ) use ( $likes_data, $ticket_type_names, $participant_option_names, $participant_option_ids, $participant_questionnaire ) {
				$participant = $this->participant_repo->get_by_id( $ep->participant_id );
				return array(
					'id'                    => $ep->id,
					'participant_id'        => $ep->participant_id,
					'event_date_id'         => $ep->event_date_id,
					'participant_name'      => $participant ? $participant->name . ' ' . $participant->surname : '',
					'name'                  => $participant ? $participant->name : '',
					'surname'               => $participant ? $participant->surname : '',
					'participant_email'     => $participant ? $participant->email : '',
					'email_profile'         => $participant ? $participant->email_profile : '',
					'instagram'             => $participant ? $participant->instagram : '',
					'label'                 => $ep->label,
					'ticket_type_id'        => $ep->ticket_type_id ? (int) $ep->ticket_type_id : null,
					'ticket_type_name'      => $ep->ticket_type_id && isset( $ticket_type_names[ $ep->ticket_type_id ] )
						? $ticket_type_names[ $ep->ticket_type_id ]
						: null,
					'attended_at'           => $ep->attended_at,
					'created_at'            => $ep->created_at,
					'payment_expires_at'    => $ep->payment_expires_at,
					'photo_likes_received'  => isset( $likes_data[ $ep->participant_id ] )
						? (int) $likes_data[ $ep->participant_id ]->likes_count
						: 0,
					'ticket_option_names'   => $participant_option_names[ $ep->id ] ?? array(),
					'ticket_option_ids'     => $participant_option_ids[ $ep->id ] ?? array(),
					'admin_comment'         => isset( $ep->admin_comment ) && null !== $ep->admin_comment ? $ep->admin_comment : '',
					'questionnaire_answers' => $participant_questionnaire[ $ep->participant_id ] ?? array(),
				);
			},
			$event_participants
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Build a map of participant ID → custom question answers for the signups
	 * on an event date. Answers come from "Event Signup" questionnaire
	 * submissions (created by the Event Signup block). File-upload answers gain
	 * a resolved URL, mirroring QuestionnaireResponsesController.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Map of participant_id => array of answer arrays.
	 */
	private function get_signup_answers_by_participant( $event_date_id ) {
		$submission_repo = new QuestionnaireSubmissionRepository();
		$answer_repo     = new QuestionnaireAnswerRepository();

		$submissions = $submission_repo->get_by_filters(
			array(
				'event_date_id' => $event_date_id,
				'title'         => __( 'Event Signup', 'fair-audience' ),
			)
		);

		$by_participant = array();
		foreach ( $submissions as $submission ) {
			// One signup submission per participant; get_by_filters orders by
			// created_at DESC, so the first seen is the newest — keep that.
			if ( isset( $by_participant[ $submission->participant_id ] ) ) {
				continue;
			}

			$answers_data = array();
			foreach ( $answer_repo->get_by_submission( $submission->id ) as $answer ) {
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

				$answers_data[] = $answer_item;
			}

			$by_participant[ $submission->participant_id ] = $answers_data;
		}

		return $by_participant;
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
			$seats_per_ticket   = max( 1, (int) $ep_row->seats );

			if ( $new_ticket_type_id && class_exists( \FairEvents\Models\TicketType::class ) ) {
				$ticket_type = \FairEvents\Models\TicketType::get_by_id( $new_ticket_type_id );
				if ( ! $ticket_type ) {
					return new WP_Error(
						'invalid_ticket_type',
						__( 'Selected ticket type was not found.', 'fair-audience' ),
						array( 'status' => 400 )
					);
				}
				$seats_per_ticket = max( 1, (int) $ticket_type->seats_per_ticket );
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->update(
				$wpdb->prefix . 'fair_audience_event_participants',
				array(
					'ticket_type_id' => $new_ticket_type_id,
					'seats'          => $seats_per_ticket,
				),
				array( 'id' => (int) $ep_row->id ),
				array( '%d', '%d' ),
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

				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$wpdb->delete( $table_name, array( 'event_participant_id' => $ep_id ), array( '%d' ) );

				$lookup_event_date_id = $event_date_id;
				if ( class_exists( \FairEvents\Models\EventDates::class ) ) {
					$ed = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
					if ( $ed && 'generated' === $ed->occurrence_type && $ed->master_id ) {
						$lookup_event_date_id = (int) $ed->master_id;
					}
				}

				$by_id   = array();
				$by_name = array();
				if ( class_exists( \FairEventsExperimental\Models\TicketOption::class ) ) {
					$all_options = \FairEventsExperimental\Models\TicketOption::get_all_by_event_date_id( $lookup_event_date_id );
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
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
					$wpdb->replace(
						$table_name,
						array(
							'event_participant_id' => $ep_id,
							'ticket_option_id'     => (int) $opt->id,
							'ticket_option_name'   => $opt->name,
						),
						array( '%d', '%d', '%s' )
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
	 * Upgrade selected participants of an event to the marketing email profile.
	 *
	 * Records the organizer's marketing consent (e.g. collected verbally / on a
	 * paper list at the event), flips each eligible participant's email_profile
	 * from "minimal" to "marketing", writes an audit-trail entry, and sends a
	 * one-time "welcome to the mailing list" email. Already-marketing
	 * participants and participants without an email are skipped (never
	 * re-emailed), making the operation idempotent.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function upgrade_to_marketing_batch( $request ) {
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
			'upgraded'     => 0,
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

		foreach ( $participant_ids as $participant_id ) {
			$participant_id = (int) $participant_id;

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

			// Must be linked to this event date.
			$ep_row = $this->event_participant_repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
			if ( ! $ep_row ) {
				++$results['skipped'];
				continue;
			}

			// Skip participants without an email or already on the marketing list
			// (the latter guarantees we never re-email an already-subscribed person).
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

			// Audit trail.
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
						gmdate( 'Y-m-d' ),
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

		return rest_ensure_response( $results );
	}

	/**
	 * Get all events with participant counts, gallery count, and likes count.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_events( $request ) {
		global $wpdb;

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
			// For event_date, participants, images, likes - fetch all and sort in PHP.
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

			// Get gallery image count from fair_events_event_photos table.
			$gallery_count = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM {$wpdb->prefix}fair_events_event_photos WHERE event_id = %d",
					$event->ID
				)
			);

			// Get likes count for all photos in this event.
			$likes_count = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM {$wpdb->prefix}fair_events_photo_likes pl
					 INNER JOIN {$wpdb->prefix}fair_events_event_photos ep ON pl.attachment_id = ep.attachment_id
					 WHERE ep.event_id = %d",
					$event->ID
				)
			);

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
				'gallery_count'      => $gallery_count,
				'likes_count'        => $likes_count,
			);
		}

		// Handle sorting by computed fields (all except title which uses WP_Query).
		if ( 'title' !== $orderby ) {
			$sort_key = $orderby;
			if ( 'images' === $orderby ) {
				$sort_key = 'gallery_count';
			} elseif ( 'likes' === $orderby ) {
				$sort_key = 'likes_count';
			}

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
		global $wpdb;

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

		// Get gallery image count.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$gallery_count = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->prefix}fair_events_event_photos WHERE event_id = %d",
				$event_id
			)
		);

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
			'gallery_count'    => $gallery_count,
			'gallery_link'     => admin_url( "upload.php?mode=list&fair_event_filter={$event_id}" ),
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
}
