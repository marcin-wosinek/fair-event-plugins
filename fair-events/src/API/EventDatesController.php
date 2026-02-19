<?php
/**
 * REST API Controller for Event Dates
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Services\RecurrenceService;
use FairEvents\Database\EventPhotoRepository;
use FairEvents\Database\PhotoLikeRepository;
use FairEvents\Frontend\EventGalleryPage;
use FairEvents\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles event dates REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventDatesController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for event dates
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET, POST /fair-events/v1/event-dates.
		register_rest_route(
			$this->namespace,
			'/event-dates',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
			)
		);

		// GET, PUT, DELETE /fair-events/v1/event-dates/{id}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the event date.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_update_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the event date.', 'fair-events' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// POST /fair-events/v1/event-dates/{id}/create-post - Create WP post and link it.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/create-post',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_post' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'id'          => array(
							'description' => __( 'Event date ID to link to.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_type'   => array(
							'description' => __( 'Post type for the new post.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'fair_event',
						),
						'post_status' => array(
							'description' => __( 'Status for the new post.', 'fair-events' ),
							'type'        => 'string',
							'default'     => 'draft',
						),
					),
				),
			)
		);

		// POST /fair-events/v1/event-dates/{id}/link-post - Link an existing post.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/link-post',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'link_post' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_id' => array(
							'description' => __( 'Post ID to link.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// DELETE /fair-events/v1/event-dates/{id}/link-post - Unlink a post.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/link-post',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'unlink_post' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
						),
						'post_id' => array(
							'description' => __( 'Post ID to unlink.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get arguments for create/update endpoints
	 *
	 * @return array Arguments definition.
	 */
	private function get_create_update_args() {
		return array(
			'title'          => array(
				'description'       => __( 'Event title.', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'start_datetime' => array(
				'description'       => __( 'Start date/time (Y-m-d H:i:s format).', 'fair-events' ),
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'end_datetime'   => array(
				'description'       => __( 'End date/time (Y-m-d H:i:s format).', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'all_day'        => array(
				'description' => __( 'Whether this is an all-day event.', 'fair-events' ),
				'type'        => 'boolean',
				'required'    => false,
				'default'     => false,
			),
			'venue_id'       => array(
				'description' => __( 'Venue ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'link_type'      => array(
				'description' => __( 'Link type (post, external, none).', 'fair-events' ),
				'type'        => 'string',
				'required'    => false,
				'default'     => 'none',
				'enum'        => array( 'post', 'external', 'none' ),
			),
			'external_url'   => array(
				'description'       => __( 'External URL for the event.', 'fair-events' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'esc_url_raw',
			),
			'theme_image_id' => array(
				'description' => __( 'Theme image attachment ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'event_id'       => array(
				'description' => __( 'Linked post ID.', 'fair-events' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'rrule'          => array(
				'description'       => __( 'Recurrence rule in RRULE format.', 'fair-events' ),
				'type'              => array( 'string', 'null' ),
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'categories'     => array(
				'description' => __( 'Category term IDs.', 'fair-events' ),
				'type'        => 'array',
				'required'    => false,
				'items'       => array( 'type' => 'integer' ),
			),
		);
	}

	/**
	 * Get args for update requests (all fields optional)
	 *
	 * @return array Update endpoint arguments.
	 */
	private function get_update_args() {
		$args = $this->get_create_update_args();

		// For updates, title and start_datetime are optional.
		$args['title']['required']          = false;
		$args['start_datetime']['required'] = false;

		return $args;
	}

	/**
	 * Create a standalone event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$title          = $request->get_param( 'title' );
		$start_datetime = $request->get_param( 'start_datetime' );
		$end_datetime   = $request->get_param( 'end_datetime' );
		$all_day        = $request->get_param( 'all_day' );
		$venue_id       = $request->get_param( 'venue_id' );
		$link_type      = $request->get_param( 'link_type' ) ?? 'none';
		$external_url   = $request->get_param( 'external_url' );

		if ( empty( $title ) ) {
			return new WP_Error(
				'rest_invalid_title',
				__( 'Event title is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $start_datetime ) ) {
			return new WP_Error(
				'rest_invalid_start',
				__( 'Start date/time is required.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$data = array(
			'title'          => $title,
			'start_datetime' => $start_datetime,
			'end_datetime'   => $end_datetime,
			'all_day'        => $all_day,
			'link_type'      => $link_type,
			'external_url'   => $external_url,
		);

		$id = EventDates::create_standalone( $data );

		if ( ! $id ) {
			return new WP_Error(
				'rest_event_date_creation_failed',
				__( 'Failed to create event date.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Set venue if provided.
		if ( $venue_id ) {
			EventDates::update_by_id( $id, array( 'venue_id' => $venue_id ) );
		}

		// Regenerate recurrence occurrences if rrule is provided.
		$rrule = $request->get_param( 'rrule' );
		if ( ! empty( $rrule ) ) {
			EventDates::update_by_id( $id, array( 'rrule' => $rrule ) );
			RecurrenceService::regenerate_standalone_occurrences( $id, $rrule );
		}

		// Set categories for standalone event date.
		$categories = $request->get_param( 'categories' );
		if ( is_array( $categories ) ) {
			$this->set_standalone_categories( $id, $categories );
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 201 );
	}

	/**
	 * Get event dates
	 *
	 * By default returns unlinked events. Pass include_linked=true to include all events.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$include_linked = $request->get_param( 'include_linked' );

		if ( $include_linked ) {
			$event_dates = $this->get_all_master_event_dates();
		} else {
			$event_dates = EventDates::get_unlinked();
		}

		$items = array();
		foreach ( $event_dates as $event_date ) {
			$items[] = $this->prepare_event_date( $event_date );
		}

		return new WP_REST_Response( $items, 200 );
	}

	/**
	 * Get all master/single event dates (including linked ones)
	 *
	 * @return EventDates[] Array of EventDates objects.
	 */
	private function get_all_master_event_dates() {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_dates';

		$results = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM %i WHERE occurrence_type IN ('single', 'master') ORDER BY start_datetime DESC",
				$table_name
			)
		);

		if ( ! $results ) {
			return array();
		}

		$dates = array();
		foreach ( $results as $result ) {
			$dates[] = EventDates::get_by_id( (int) $result->id );
		}

		return array_filter( $dates );
	}

	/**
	 * Get single event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id         = (int) $request->get_param( 'id' );
		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Update event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id       = (int) $request->get_param( 'id' );
		$existing = EventDates::get_by_id( $id );

		if ( ! $existing ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$update_data = array();

		$title = $request->get_param( 'title' );
		if ( null !== $title ) {
			$update_data['title'] = $title;
		}

		$start_datetime = $request->get_param( 'start_datetime' );
		if ( null !== $start_datetime ) {
			$update_data['start_datetime'] = $start_datetime;
		}

		$end_datetime = $request->get_param( 'end_datetime' );
		if ( null !== $end_datetime ) {
			$update_data['end_datetime'] = $end_datetime;
		}

		$all_day = $request->get_param( 'all_day' );
		if ( null !== $all_day ) {
			$update_data['all_day'] = $all_day ? 1 : 0;
		}

		if ( $request->has_param( 'venue_id' ) ) {
			$update_data['venue_id'] = $request->get_param( 'venue_id' );
		}

		$link_type = $request->get_param( 'link_type' );
		if ( null !== $link_type ) {
			$update_data['link_type'] = $link_type;
		}

		$external_url = $request->get_param( 'external_url' );
		if ( null !== $external_url ) {
			$update_data['external_url'] = $external_url;
		}

		$theme_image_id = $request->get_param( 'theme_image_id' );
		if ( null !== $theme_image_id ) {
			$update_data['theme_image_id'] = $theme_image_id ? absint( $theme_image_id ) : null;
		}

		$event_id = $request->get_param( 'event_id' );
		if ( null !== $event_id ) {
			$new_event_id            = $event_id ? absint( $event_id ) : null;
			$update_data['event_id'] = $new_event_id;

			// Keep junction table in sync.
			if ( $new_event_id ) {
				EventDates::add_linked_post( $id, $new_event_id );
			}
			if ( $existing->event_id && ( ! $new_event_id || $new_event_id !== $existing->event_id ) ) {
				EventDates::remove_linked_post( $id, $existing->event_id );
			}
		}

		$rrule = $request->get_param( 'rrule' );
		if ( null !== $rrule ) {
			$update_data['rrule'] = $rrule ?: null;
		}

		if ( ! empty( $update_data ) ) {
			$success = EventDates::update_by_id( $id, $update_data );

			if ( ! $success ) {
				return new WP_Error(
					'rest_event_date_update_failed',
					__( 'Failed to update event date.', 'fair-events' ),
					array( 'status' => 500 )
				);
			}

			// Determine the effective event_id after update.
			$effective_event_id = isset( $update_data['event_id'] ) ? $update_data['event_id'] : $existing->event_id;

			// Sync title to linked post when title changes.
			if ( $effective_event_id && isset( $update_data['title'] ) ) {
				wp_update_post(
					array(
						'ID'         => $effective_event_id,
						'post_title' => $update_data['title'],
					)
				);
			}

			// Regenerate recurrence occurrences when rrule or dates change.
			$rrule_changed              = isset( $update_data['rrule'] );
			$dates_changed_on_recurring = $dates_changed && ( $existing->occurrence_type === 'master' || $rrule_changed );

			if ( $rrule_changed || $dates_changed_on_recurring ) {
				$effective_rrule = $update_data['rrule'] ?? $existing->rrule;

				if ( $effective_event_id ) {
					RecurrenceService::regenerate_event_occurrences( $effective_event_id, $effective_rrule );
				} else {
					RecurrenceService::regenerate_standalone_occurrences( $id, $effective_rrule );
				}
			}

			// When linking a standalone event to a post, copy categories to post taxonomy.
			if ( $newly_linked ) {
				$standalone_cat_ids = $this->get_standalone_category_ids( $id );
				if ( ! empty( $standalone_cat_ids ) ) {
					wp_set_post_terms( $effective_event_id, $standalone_cat_ids, 'category' );
					$this->set_standalone_categories( $id, array() );
				}
			}

			// When unlinking a post-linked event, copy categories to junction table.
			$newly_unlinked = isset( $update_data['event_id'] ) && ! $update_data['event_id'] && $existing->event_id;
			if ( $newly_unlinked ) {
				$terms   = wp_get_post_terms( $existing->event_id, 'category' );
				$cat_ids = array();
				if ( ! is_wp_error( $terms ) ) {
					$cat_ids = wp_list_pluck( $terms, 'term_id' );
				}
				if ( ! empty( $cat_ids ) ) {
					$this->set_standalone_categories( $id, $cat_ids );
				}
			}
		}

		// Handle categories parameter.
		$categories = $request->get_param( 'categories' );
		if ( is_array( $categories ) ) {
			// Re-fetch to get latest state after potential link changes.
			$current = EventDates::get_by_id( $id );
			if ( $current->event_id ) {
				wp_set_post_terms( $current->event_id, $categories, 'category' );
			} else {
				$this->set_standalone_categories( $id, $categories );
			}
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Delete event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id       = (int) $request->get_param( 'id' );
		$existing = EventDates::get_by_id( $id );

		if ( ! $existing ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$success = EventDates::delete_by_id( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_event_date_delete_failed',
				__( 'Failed to delete event date.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted'    => true,
				'event_date' => $this->prepare_event_date( $existing ),
			),
			200
		);
	}

	/**
	 * Create a WordPress post and link it to an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_post( $request ) {
		$id          = (int) $request->get_param( 'id' );
		$post_type   = $request->get_param( 'post_type' ) ?? 'fair_event';
		$post_status = $request->get_param( 'post_status' ) ?? 'draft';

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Validate post type is enabled.
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post_type, $enabled_post_types, true ) ) {
			return new WP_Error(
				'rest_invalid_post_type',
				__( 'The specified post type is not enabled.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Create the WordPress post.
		$post_id = wp_insert_post(
			array(
				'post_title'  => $event_date->title ?? __( 'Untitled Event', 'fair-events' ),
				'post_type'   => $post_type,
				'post_status' => $post_status,
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return new WP_Error(
				'rest_post_creation_failed',
				$post_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// Link the event date to the post.
		EventDates::update_by_id(
			$id,
			array(
				'event_id'  => $post_id,
				'link_type' => 'post',
			)
		);

		// Add to junction table.
		EventDates::add_linked_post( $id, $post_id );

		// Copy standalone categories to the new post.
		$standalone_cat_ids = $this->get_standalone_category_ids( $id );
		if ( ! empty( $standalone_cat_ids ) ) {
			wp_set_post_terms( $post_id, $standalone_cat_ids, 'category' );
			$this->set_standalone_categories( $id, array() );
		}

		$edit_url = get_edit_post_link( $post_id, 'raw' );

		return new WP_REST_Response(
			array(
				'post_id'  => $post_id,
				'edit_url' => $edit_url,
			),
			201
		);
	}

	/**
	 * Link an existing post to an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function link_post( $request ) {
		$id      = (int) $request->get_param( 'id' );
		$post_id = (int) $request->get_param( 'post_id' );

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			return new WP_Error(
				'rest_post_not_found',
				__( 'Post not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Add to junction table.
		EventDates::add_linked_post( $id, $post_id );

		// If this is the first linked post (no primary set), set as primary.
		if ( ! $event_date->event_id ) {
			EventDates::update_by_id(
				$id,
				array(
					'event_id'  => $post_id,
					'link_type' => 'post',
				)
			);
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Unlink a post from an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function unlink_post( $request ) {
		$id      = (int) $request->get_param( 'id' );
		$post_id = (int) $request->get_param( 'post_id' );

		$event_date = EventDates::get_by_id( $id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Remove from junction table.
		EventDates::remove_linked_post( $id, $post_id );

		// If this was the primary post, promote next linked post.
		if ( (int) $event_date->event_id === $post_id ) {
			$remaining_post_ids = EventDates::get_linked_post_ids( $id );

			if ( ! empty( $remaining_post_ids ) ) {
				// Promote first remaining post to primary.
				$new_primary = $remaining_post_ids[0];
				EventDates::update_by_id( $id, array( 'event_id' => $new_primary ) );
			} else {
				// No more linked posts, clear event_id and set link_type to none.
				EventDates::update_by_id(
					$id,
					array(
						'event_id'  => null,
						'link_type' => 'none',
					)
				);
			}
		}

		$event_date = EventDates::get_by_id( $id );

		return new WP_REST_Response( $this->prepare_event_date( $event_date ), 200 );
	}

	/**
	 * Prepare event date data for response
	 *
	 * @param EventDates $event_date Event date object.
	 * @return array Prepared event date data.
	 */
	private function prepare_event_date( $event_date ) {
		$data = array(
			'id'              => $event_date->id,
			'event_id'        => $event_date->event_id,
			'title'           => $event_date->title,
			'start_datetime'  => $event_date->start_datetime,
			'end_datetime'    => $event_date->end_datetime,
			'all_day'         => $event_date->all_day,
			'occurrence_type' => $event_date->occurrence_type,
			'venue_id'        => $event_date->venue_id,
			'link_type'       => $event_date->link_type,
			'external_url'    => $event_date->external_url,
			'rrule'           => $event_date->rrule,
			'theme_image_id'  => $event_date->theme_image_id ? (int) $event_date->theme_image_id : null,
			'theme_image_url' => $event_date->theme_image_id
				? wp_get_attachment_image_url( $event_date->theme_image_id, 'full' )
				: null,
		);

		// Add categories.
		$data['categories'] = $this->get_event_date_categories( $event_date );

		// Add image exports.
		$data['image_exports'] = ImageExportController::get_exports_for_event_date( $event_date->id );

		// Add all linked posts from junction table.
		$linked_post_ids      = EventDates::get_linked_post_ids( $event_date->id );
		$data['linked_posts'] = array();
		foreach ( $linked_post_ids as $linked_post_id ) {
			$linked_post = get_post( $linked_post_id );
			if ( $linked_post ) {
				$data['linked_posts'][] = array(
					'id'         => $linked_post->ID,
					'title'      => $linked_post->post_title,
					'status'     => $linked_post->post_status,
					'edit_url'   => get_edit_post_link( $linked_post->ID, 'raw' ),
					'is_primary' => (int) $linked_post->ID === (int) $event_date->event_id,
				);
			}
		}

		// Add linked post info if applicable (primary post).
		if ( $event_date->event_id ) {
			$post = get_post( $event_date->event_id );
			if ( $post ) {
				$data['post'] = array(
					'id'       => $post->ID,
					'title'    => $post->post_title,
					'status'   => $post->post_status,
					'edit_url' => get_edit_post_link( $post->ID, 'raw' ),
				);
			}

			// Add photo gallery info.
			$photo_repo     = new EventPhotoRepository();
			$photo_count    = $photo_repo->get_count_by_event( $event_date->event_id );
			$total_likes    = 0;
			$attachment_ids = $photo_repo->get_attachment_ids_by_event( $event_date->event_id );
			if ( ! empty( $attachment_ids ) ) {
				$like_repo   = new PhotoLikeRepository();
				$like_counts = $like_repo->get_counts_for_photos( $attachment_ids );
				$total_likes = array_sum( $like_counts );
			}
			$data['gallery'] = array(
				'photo_count' => $photo_count,
				'total_likes' => $total_likes,
				'gallery_url' => EventGalleryPage::get_gallery_url( $event_date->event_id ),
			);
		}

		return $data;
	}

	/**
	 * Get categories for an event date
	 *
	 * @param object $event_date Event date object.
	 * @return array Array of category objects with id, name, slug.
	 */
	private function get_event_date_categories( $event_date ) {
		if ( $event_date->event_id ) {
			$terms = wp_get_post_terms( $event_date->event_id, 'category' );
			if ( is_wp_error( $terms ) ) {
				return array();
			}
			return array_map(
				function ( $term ) {
					return array(
						'id'   => $term->term_id,
						'name' => $term->name,
						'slug' => $term->slug,
					);
				},
				$terms
			);
		}

		return $this->get_standalone_categories( $event_date->id );
	}

	/**
	 * Get categories for a standalone event date from junction table
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of category objects with id, name, slug.
	 */
	private function get_standalone_categories( $event_date_id ) {
		$term_ids = $this->get_standalone_category_ids( $event_date_id );
		if ( empty( $term_ids ) ) {
			return array();
		}

		$categories = array();
		foreach ( $term_ids as $term_id ) {
			$term = get_term( $term_id, 'category' );
			if ( $term && ! is_wp_error( $term ) ) {
				$categories[] = array(
					'id'   => $term->term_id,
					'name' => $term->name,
					'slug' => $term->slug,
				);
			}
		}
		return $categories;
	}

	/**
	 * Get category term IDs for a standalone event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of term IDs.
	 */
	private function get_standalone_category_ids( $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_categories';

		$term_ids = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT term_id FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);

		return array_map( 'intval', $term_ids );
	}

	/**
	 * Set categories for a standalone event date in junction table
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $category_ids  Array of term IDs.
	 * @return void
	 */
	private function set_standalone_categories( $event_date_id, $category_ids ) {
		global $wpdb;

		$table_name = $wpdb->prefix . 'fair_event_date_categories';

		// Delete existing rows.
		$wpdb->delete(
			$table_name,
			array( 'event_date_id' => $event_date_id ),
			array( '%d' )
		);

		// Insert new rows.
		foreach ( $category_ids as $term_id ) {
			$wpdb->insert(
				$table_name,
				array(
					'event_date_id' => $event_date_id,
					'term_id'       => (int) $term_id,
				),
				array( '%d', '%d' )
			);
		}
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Check permissions for deleting item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
