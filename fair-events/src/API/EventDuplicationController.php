<?php
/**
 * Event Duplication REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Core\Plugin;
use FairEvents\Models\EventDates;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles cloning linked posts for event duplication.
 */
class EventDuplicationController extends WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-events/v1';
		$this->rest_base = 'event-dates';
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)/clone-posts',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'clone_posts' ),
					'permission_callback' => function () {
						return current_user_can( 'edit_posts' );
					},
					'args'                => array(
						'id'                   => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'source_event_date_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Clone linked posts from a source event date to a target event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function clone_posts( $request ) {
		$target_event_date_id = $request->get_param( 'id' );
		$source_event_date_id = $request->get_param( 'source_event_date_id' );

		// Validate target event date exists.
		$target = EventDates::get_by_id( $target_event_date_id );
		if ( ! $target ) {
			return new WP_Error(
				'not_found',
				__( 'Target event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Validate source event date exists.
		$source = EventDates::get_by_id( $source_event_date_id );
		if ( ! $source ) {
			return new WP_Error(
				'not_found',
				__( 'Source event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Get linked post IDs from source.
		$linked_post_ids = EventDates::get_linked_post_ids( $source_event_date_id );
		if ( empty( $linked_post_ids ) ) {
			return new WP_Error(
				'no_posts',
				__( 'Source event has no linked posts to clone.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$first_cloned_id = null;

		// Suppress auto-creation of event_date rows for each cloned post — the
		// clones are attached to an existing target event_date, and the hook's
		// NULL datetimes would violate the NOT NULL schema constraint.
		$plugin = Plugin::instance();
		remove_action( 'wp_after_insert_post', array( $plugin, 'auto_create_event_date' ), 10 );

		try {
			foreach ( $linked_post_ids as $post_id ) {
				$original_post = get_post( $post_id );
				if ( ! $original_post ) {
					continue;
				}

				// Create new post as draft copy.
				$new_post_data = array(
					'post_title'   => $original_post->post_title,
					'post_content' => $original_post->post_content,
					'post_excerpt' => $original_post->post_excerpt,
					'post_type'    => $original_post->post_type,
					'post_status'  => 'draft',
					'post_author'  => get_current_user_id(),
				);

				$new_post_id = wp_insert_post( $new_post_data );

				if ( is_wp_error( $new_post_id ) ) {
					continue;
				}

				// Copy featured image.
				$thumbnail_id = get_post_thumbnail_id( $original_post->ID );
				if ( $thumbnail_id ) {
					set_post_thumbnail( $new_post_id, $thumbnail_id );
				}

				// Copy taxonomies.
				$taxonomies = get_object_taxonomies( $original_post->post_type );
				foreach ( $taxonomies as $taxonomy ) {
					$terms = wp_get_object_terms( $original_post->ID, $taxonomy, array( 'fields' => 'ids' ) );
					if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
						wp_set_object_terms( $new_post_id, $terms, $taxonomy );
					}
				}

				// Link cloned post to target event date.
				EventDates::add_linked_post( $target_event_date_id, $new_post_id );

				if ( null === $first_cloned_id ) {
					$first_cloned_id = $new_post_id;
				}
			}
		} finally {
			add_action( 'wp_after_insert_post', array( $plugin, 'auto_create_event_date' ), 10, 4 );
		}

		// Set first cloned post as primary event_id.
		if ( $first_cloned_id ) {
			EventDates::update_by_id(
				$target_event_date_id,
				array(
					'event_id'  => $first_cloned_id,
					'link_type' => 'post',
				)
			);
		}

		// Return success with the target event date ID.
		return rest_ensure_response(
			array(
				'success'              => true,
				'target_event_date_id' => $target_event_date_id,
				'event_id'             => $first_cloned_id,
			)
		);
	}
}
