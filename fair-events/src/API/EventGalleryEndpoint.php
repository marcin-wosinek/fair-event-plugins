<?php
/**
 * Event Gallery REST API Endpoint
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventPhotoRepository;
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

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
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
				'posts_per_page' => -1,
				'post_status'    => 'inherit',
				'post__in'       => $attachment_ids,
				'orderby'        => 'post__in',
			)
		);

		$items = array();
		foreach ( $attachments as $attachment ) {
			$items[] = array(
				'id'          => $attachment->ID,
				'title'       => $attachment->post_title,
				'caption'     => $attachment->post_excerpt,
				'description' => $attachment->post_content,
				'alt_text'    => get_post_meta( $attachment->ID, '_wp_attachment_image_alt', true ),
				'mime_type'   => $attachment->post_mime_type,
				'url'         => wp_get_attachment_url( $attachment->ID ),
				'sizes'       => array(
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
