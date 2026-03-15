<?php
/**
 * Event Gallery REST API Endpoint
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventPhotoRepository;
use FairEvents\Database\PhotoLikeRepository;
use FairEvents\Models\EventDates;
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
	protected $rest_base = 'event-dates/(?P<event_date_id>[\d]+)/gallery';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-events/v1/event-dates/{event_date_id}/gallery.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => '__return_true', // Public endpoint.
					'args'                => array(
						'event_date_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	/**
	 * Get all photos for an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$event_date_id = $request->get_param( 'event_date_id' );

		// Validate event date exists.
		$event_date = EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'invalid_event',
				__( 'Event not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$repository     = new EventPhotoRepository();
		$attachment_ids = $repository->get_attachment_ids_by_event_date( $event_date_id );

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

		// Get like counts and liker details for all photos.
		$like_repository = new PhotoLikeRepository();
		$like_counts     = $like_repository->get_counts_for_photos( $attachment_ids );
		$likes_by_photo  = $like_repository->get_likes_for_photos( $attachment_ids );

		// Load tagged participants and photo authors if fair-audience plugin is active.
		$tags_by_attachment    = array();
		$authors_by_attachment = array();
		if ( class_exists( 'FairAudience\Database\PhotoParticipantRepository' ) ) {
			$photo_repo         = new \FairAudience\Database\PhotoParticipantRepository();
			$participant_repo   = new \FairAudience\Database\ParticipantRepository();
			$tags_by_attachment = $photo_repo->get_tagged_for_attachments( $attachment_ids );

			// Load photo authors (fair-audience participants, not WP users).
			foreach ( $attachment_ids as $aid ) {
				$photo_author = $photo_repo->get_author_for_attachment( $aid );
				if ( $photo_author ) {
					$participant = $participant_repo->get_by_id( $photo_author->participant_id );
					if ( $participant ) {
						$authors_by_attachment[ $aid ] = trim( $participant->name . ' ' . $participant->surname );
					}
				}
			}
		}

		$items = array();
		foreach ( $attachments as $attachment ) {
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

			// Resolve liker names.
			$liked_by = array();
			if ( ! empty( $likes_by_photo[ $attachment->ID ] ) ) {
				foreach ( $likes_by_photo[ $attachment->ID ] as $like ) {
					if ( ! empty( $like->participant_id ) && isset( $participant_repo ) ) {
						$participant = $participant_repo->get_by_id( $like->participant_id );
						if ( $participant ) {
							$liked_by[] = trim( $participant->name . ' ' . $participant->surname );
						}
					} elseif ( ! empty( $like->user_id ) ) {
						$wp_user = get_user_by( 'id', $like->user_id );
						if ( $wp_user ) {
							$liked_by[] = $wp_user->display_name;
						}
					}
				}
			}

			// Use fair-audience photo author if available, fall back to WP user.
			$author_name = $authors_by_attachment[ $attachment->ID ] ?? '';
			if ( empty( $author_name ) ) {
				$wp_author   = get_user_by( 'id', $attachment->post_author );
				$author_name = $wp_author ? $wp_author->display_name : '';
			}

			$items[] = array(
				'id'                  => $attachment->ID,
				'title'               => $attachment->post_title,
				'caption'             => $attachment->post_excerpt,
				'description'         => $attachment->post_content,
				'alt_text'            => get_post_meta( $attachment->ID, '_wp_attachment_image_alt', true ),
				'mime_type'           => $attachment->post_mime_type,
				'url'                 => wp_get_attachment_url( $attachment->ID ),
				'author_name'         => $author_name,
				'likes_count'         => $like_counts[ $attachment->ID ] ?? 0,
				'liked_by'            => $liked_by,
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
