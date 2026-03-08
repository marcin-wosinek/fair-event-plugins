<?php
/**
 * Event Gallery REST API Endpoint
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventPhotoRepository;
use FairEvents\Database\PhotoLikeRepository;
use FairEvents\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for event gallery photos.
 */
class EventGalleryEndpoint extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'events/(?P<event_id>[\d]+)/gallery';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-events/v1/events/{event_id}/gallery.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => '__return_true', // Public endpoint.
					'args'                => array(
						'event_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all photos for an event.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$event_id = $request->get_param( 'event_id' );

		// Validate event exists and is an enabled post type.
		$event              = get_post( $event_id );
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! $event || ! in_array( $event->post_type, $enabled_post_types, true ) ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$repository     = new EventPhotoRepository();
		$attachment_ids = $repository->get_attachment_ids_by_event( $event_id );

		if ( empty( $attachment_ids ) ) {
			return rest_ensure_response( array() );
		}

		$attachments = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_mime_type' => 'image',
				'posts_per_page' => -1,
				'post_status'    => 'inherit',
				'post__in'       => $attachment_ids,
				'orderby'        => 'post__in',
			)
		);

		// Get like counts for all photos in one query.
		$like_repository = new PhotoLikeRepository();
		$like_counts     = $like_repository->get_counts_for_photos( $attachment_ids );

		// Load tagged participants if fair-audience plugin is active.
		$tags_by_attachment = array();
		if ( class_exists( 'FairAudience\Database\PhotoParticipantRepository' ) ) {
			$photo_repo         = new \FairAudience\Database\PhotoParticipantRepository();
			$participant_repo   = new \FairAudience\Database\ParticipantRepository();
			$tags_by_attachment = $photo_repo->get_tagged_for_attachments( $attachment_ids );
		}

		$items = array();
		foreach ( $attachments as $attachment ) {
			$author = get_user_by( 'id', $attachment->post_author );

			$tagged_participants = array();
			if ( ! empty( $tags_by_attachment[ $attachment->ID ] ) ) {
				foreach ( $tags_by_attachment[ $attachment->ID ] as $tag ) {
					$participant           = $participant_repo->get_by_id( $tag->participant_id );
					$tagged_participants[] = array(
						'participant_id' => $tag->participant_id,
						'name'           => $participant ? trim( $participant->name . ' ' . $participant->surname ) : '',
					);
				}
			}

			$items[] = array(
				'id'                  => $attachment->ID,
				'title'               => $attachment->post_title,
				'caption'             => $attachment->post_excerpt,
				'description'         => $attachment->post_content,
				'alt_text'            => get_post_meta( $attachment->ID, '_wp_attachment_image_alt', true ),
				'mime_type'           => $attachment->post_mime_type,
				'url'                 => wp_get_attachment_url( $attachment->ID ),
				'author_name'         => $author ? $author->display_name : '',
				'likes_count'         => $like_counts[ $attachment->ID ] ?? 0,
				'tags_count'          => count( $tagged_participants ),
				'tagged_participants' => $tagged_participants,
				'sizes'               => array(
					'thumbnail' => wp_get_attachment_image_url( $attachment->ID, 'thumbnail' ),
					'medium'    => wp_get_attachment_image_url( $attachment->ID, 'medium' ),
					'large'     => wp_get_attachment_image_url( $attachment->ID, 'large' ),
					'full'      => wp_get_attachment_image_url( $attachment->ID, 'full' ),
				),
			);
		}

		return rest_ensure_response( $items );
	}
}
