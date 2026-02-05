<?php
/**
 * Event Participants REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
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
	protected $rest_base = 'events/(?P<event_id>\d+)/participants';

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
		// GET /fair-audience/v1/events/{event_id}/participants
		// POST /fair-audience/v1/events/{event_id}/participants
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => 'is_user_logged_in',
					'args'                => array(
						'event_id' => array(
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
						'event_id'       => array(
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

		// DELETE /fair-audience/v1/events/{event_id}/participants/{participant_id}
		// PUT /fair-audience/v1/events/{event_id}/participants/{participant_id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<participant_id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'event_id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'participant_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'label'          => array(
							'type'     => 'string',
							'enum'     => array( 'interested', 'signed_up', 'collaborator' ),
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_id'       => array(
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

		// DELETE /fair-audience/v1/events/{event_id}/participants/batch.
		// POST /fair-audience/v1/events/{event_id}/participants/batch.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/batch',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_batch_items' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_id'        => array(
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
						'event_id'        => array(
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

		// GET /fair-audience/v1/events (list events with participant counts)
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

		// GET /fair-audience/v1/events/{event_id} (single event info)
		register_rest_route(
			$this->namespace,
			'/events/(?P<event_id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_event' ),
				'permission_callback' => 'is_user_logged_in',
				'args'                => array(
					'event_id' => array(
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

		$event_id = $request->get_param( 'event_id' );

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$event_participants = $this->event_participant_repo->get_by_event( $event_id );

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

		$items = array_map(
			function ( $ep ) use ( $likes_data ) {
				$participant = $this->participant_repo->get_by_id( $ep->participant_id );
				return array(
					'id'                   => $ep->id,
					'participant_id'       => $ep->participant_id,
					'participant_name'     => $participant ? $participant->name . ' ' . $participant->surname : '',
					'name'                 => $participant ? $participant->name : '',
					'surname'              => $participant ? $participant->surname : '',
					'participant_email'    => $participant ? $participant->email : '',
					'instagram'            => $participant ? $participant->instagram : '',
					'label'                => $ep->label,
					'created_at'           => $ep->created_at,
					'photo_likes_received' => isset( $likes_data[ $ep->participant_id ] )
						? (int) $likes_data[ $ep->participant_id ]->likes_count
						: 0,
				);
			},
			$event_participants
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Add participant to event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );
		$label          = $request->get_param( 'label' );

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

		$id = $this->event_participant_repo->add_participant_to_event( $event_id, $participant_id, $label );

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
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );
		$label          = $request->get_param( 'label' );

		$success = $this->event_participant_repo->update_label( $event_id, $participant_id, $label );

		if ( ! $success ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update label.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Label updated successfully.', 'fair-audience' ),
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
		$event_id       = $request->get_param( 'event_id' );
		$participant_id = $request->get_param( 'participant_id' );

		$success = $this->event_participant_repo->remove_participant_from_event( $event_id, $participant_id );

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
		$event_id        = (int) $request['event_id'];
		$participant_ids = $request->get_param( 'participant_ids' );

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

			$deleted = $this->event_participant_repo->remove_participant_from_event(
				$event_id,
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
		$event_id        = (int) $request['event_id'];
		$participant_ids = $request->get_param( 'participant_ids' );
		$label           = $request->get_param( 'label' );

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
				$label
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
			$counts = $this->event_participant_repo->get_label_counts_for_event( $event->ID );

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

		$event_id = $request->get_param( 'event_id' );

		// Verify event exists.
		$event = get_post( $event_id );
		if ( ! $event || ! \FairEvents\Database\EventRepository::is_event( $event ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Get event date metadata.
		$event_date = get_post_meta( $event_id, 'event_start', true );
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
		$counts = $this->event_participant_repo->get_label_counts_for_event( $event_id );

		$signed_up     = ( $counts['signed_up'] ?? 0 ) + ( $counts['interested'] ?? 0 );
		$collaborators = $counts['collaborator'] ?? 0;

		return rest_ensure_response(
			array(
				'event_id'      => $event_id,
				'title'         => $event->post_title,
				'link'          => get_permalink( $event_id ),
				'event_date'    => $event_date,
				'gallery_count' => $gallery_count,
				'gallery_link'  => admin_url( "upload.php?mode=list&fair_event_filter={$event_id}" ),
				'signed_up'     => $signed_up,
				'collaborators' => $collaborators,
			)
		);
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
