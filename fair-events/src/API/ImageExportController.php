<?php
/**
 * REST API Controller for Image Exports
 *
 * Generates cropped versions of event theme images for different platforms.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles image export REST API endpoints
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ImageExportController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Supported export formats with dimensions
	 *
	 * @var array
	 */
	private const FORMATS = array(
		'entradium' => array(
			'width'  => 660,
			'height' => 930,
			'label'  => 'Entradium',
		),
		'meetup'    => array(
			'width'  => 1080,
			'height' => 608,
			'label'  => 'Meetup',
		),
		'homepage'  => array(
			'width'  => 1206,
			'height' => 322,
			'label'  => 'Homepage',
		),
		'facebook'  => array(
			'width'  => 1920,
			'height' => 1080,
			'label'  => 'Facebook',
		),
	);

	/**
	 * Register the routes for image exports
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-events/v1/event-dates/{id}/image-exports.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/image-exports',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
				// POST /fair-events/v1/event-dates/{id}/image-exports.
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'     => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'format' => array(
							'description'       => __( 'Export format.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'enum'              => array_keys( self::FORMATS ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// DELETE /fair-events/v1/event-dates/{id}/image-exports/{format}.
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<id>\d+)/image-exports/(?P<format>[a-z]+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'items_permissions_check' ),
					'args'                => array(
						'id'     => array(
							'description' => __( 'Event date ID.', 'fair-events' ),
							'type'        => 'integer',
							'required'    => true,
						),
						'format' => array(
							'description'       => __( 'Export format.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'enum'              => array_keys( self::FORMATS ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for image export operations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function items_permissions_check( $request ) {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * List existing image exports for an event date
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function get_items( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$event_date    = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$exports = self::get_exports_for_event_date( $event_date_id );

		return new WP_REST_Response( $exports, 200 );
	}

	/**
	 * Generate a cropped image export
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function create_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$format        = $request->get_param( 'format' );

		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! isset( self::FORMATS[ $format ] ) ) {
			return new WP_Error(
				'rest_invalid_format',
				__( 'Invalid export format.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$theme_image_id = $event_date->theme_image_id ? (int) $event_date->theme_image_id : null;

		if ( ! $theme_image_id ) {
			return new WP_Error(
				'rest_no_theme_image',
				__( 'No theme image set for this event date.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// Delete existing export for this format if any.
		$this->delete_existing_export( $event_date_id, $format );

		// Generate the cropped image.
		$result = $this->generate_crop( $theme_image_id, $event_date_id, $format );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$exports = self::get_exports_for_event_date( $event_date_id );

		return new WP_REST_Response( $exports, 201 );
	}

	/**
	 * Delete an image export
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success.
	 */
	public function delete_item( $request ) {
		$event_date_id = (int) $request->get_param( 'id' );
		$format        = $request->get_param( 'format' );

		$event_date = EventDates::get_by_id( $event_date_id );

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( ! isset( self::FORMATS[ $format ] ) ) {
			return new WP_Error(
				'rest_invalid_format',
				__( 'Invalid export format.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$this->delete_existing_export( $event_date_id, $format );

		$exports = self::get_exports_for_event_date( $event_date_id );

		return new WP_REST_Response( $exports, 200 );
	}

	/**
	 * Generate a center-cropped image for the given format
	 *
	 * @param int    $source_image_id Source attachment ID.
	 * @param int    $event_date_id   Event date ID.
	 * @param string $format          Export format key.
	 * @return int|WP_Error New attachment ID on success.
	 */
	private function generate_crop( $source_image_id, $event_date_id, $format ) {
		$source_path = get_attached_file( $source_image_id );

		if ( ! $source_path || ! file_exists( $source_path ) ) {
			return new WP_Error(
				'rest_source_not_found',
				__( 'Source image file not found.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$editor = wp_get_image_editor( $source_path );

		if ( is_wp_error( $editor ) ) {
			return new WP_Error(
				'rest_image_editor_failed',
				__( 'Failed to load image editor.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$source_size   = $editor->get_size();
		$source_width  = $source_size['width'];
		$source_height = $source_size['height'];

		$target_width  = self::FORMATS[ $format ]['width'];
		$target_height = self::FORMATS[ $format ]['height'];

		// Calculate center crop dimensions.
		$target_ratio = $target_width / $target_height;
		$source_ratio = $source_width / $source_height;

		if ( $source_ratio > $target_ratio ) {
			// Source is wider - crop horizontally.
			$crop_height = $source_height;
			$crop_width  = (int) round( $source_height * $target_ratio );
			$crop_x      = (int) round( ( $source_width - $crop_width ) / 2 );
			$crop_y      = 0;
		} else {
			// Source is taller - crop vertically.
			$crop_width  = $source_width;
			$crop_height = (int) round( $source_width / $target_ratio );
			$crop_x      = 0;
			$crop_y      = (int) round( ( $source_height - $crop_height ) / 2 );
		}

		// Crop to target aspect ratio.
		$result = $editor->crop( $crop_x, $crop_y, $crop_width, $crop_height );

		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				'rest_crop_failed',
				__( 'Failed to crop image.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Resize to exact target dimensions.
		$result = $editor->resize( $target_width, $target_height, true );

		if ( is_wp_error( $result ) ) {
			return new WP_Error(
				'rest_resize_failed',
				__( 'Failed to resize image.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Save the cropped image.
		$upload_dir = wp_upload_dir();
		$filename   = pathinfo( basename( $source_path ), PATHINFO_FILENAME );
		$extension  = pathinfo( basename( $source_path ), PATHINFO_EXTENSION );
		$new_name   = sprintf( '%s-%s-%dx%d.%s', $filename, $format, $target_width, $target_height, $extension );
		$save_path  = trailingslashit( $upload_dir['path'] ) . $new_name;

		$saved = $editor->save( $save_path );

		if ( is_wp_error( $saved ) ) {
			return new WP_Error(
				'rest_save_failed',
				__( 'Failed to save cropped image.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Create attachment.
		$attachment = array(
			'post_mime_type' => $saved['mime-type'],
			'post_title'     => sprintf(
				/* translators: 1: original filename, 2: format label */
				__( '%1$s - %2$s', 'fair-events' ),
				get_the_title( $source_image_id ),
				self::FORMATS[ $format ]['label']
			),
			'post_content'   => '',
			'post_status'    => 'inherit',
		);

		$attach_id = wp_insert_attachment( $attachment, $saved['path'] );

		if ( is_wp_error( $attach_id ) || ! $attach_id ) {
			return new WP_Error(
				'rest_attachment_failed',
				__( 'Failed to create attachment.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		// Generate attachment metadata.
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$metadata = wp_generate_attachment_metadata( $attach_id, $saved['path'] );
		wp_update_attachment_metadata( $attach_id, $metadata );

		// Set meta keys on the new attachment.
		update_post_meta( $attach_id, '_fair_events_source_image_id', $source_image_id );
		update_post_meta( $attach_id, '_fair_events_event_date_id', $event_date_id );
		update_post_meta( $attach_id, '_fair_events_crop_format', $format );

		return $attach_id;
	}

	/**
	 * Delete existing export attachment for an event date and format
	 *
	 * @param int    $event_date_id Event date ID.
	 * @param string $format        Export format key.
	 * @return void
	 */
	private function delete_existing_export( $event_date_id, $format ) {
		$existing = get_posts(
			array(
				'post_type'   => 'attachment',
				'post_status' => 'inherit',
				'meta_query'  => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					'relation' => 'AND',
					array(
						'key'     => '_fair_events_event_date_id',
						'value'   => $event_date_id,
						'compare' => '=',
						'type'    => 'NUMERIC',
					),
					array(
						'key'     => '_fair_events_crop_format',
						'value'   => $format,
						'compare' => '=',
					),
				),
				'fields'      => 'ids',
				'numberposts' => 1,
			)
		);

		foreach ( $existing as $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
	}

	/**
	 * Get all image exports for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Array of export data.
	 */
	public static function get_exports_for_event_date( $event_date_id ) {
		$attachments = get_posts(
			array(
				'post_type'   => 'attachment',
				'post_status' => 'inherit',
				'meta_query'  => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => '_fair_events_event_date_id',
						'value'   => $event_date_id,
						'compare' => '=',
						'type'    => 'NUMERIC',
					),
				),
				'numberposts' => 10,
			)
		);

		$exports = array();

		foreach ( $attachments as $attachment ) {
			$format = get_post_meta( $attachment->ID, '_fair_events_crop_format', true );

			if ( ! $format || ! isset( self::FORMATS[ $format ] ) ) {
				continue;
			}

			$exports[] = array(
				'format'          => $format,
				'label'           => self::FORMATS[ $format ]['label'],
				'width'           => self::FORMATS[ $format ]['width'],
				'height'          => self::FORMATS[ $format ]['height'],
				'attachment_id'   => $attachment->ID,
				'url'             => wp_get_attachment_url( $attachment->ID ),
				'thumbnail_url'   => wp_get_attachment_image_url( $attachment->ID, 'medium' ),
				'source_image_id' => (int) get_post_meta( $attachment->ID, '_fair_events_source_image_id', true ),
			);
		}

		return $exports;
	}

	/**
	 * Get supported formats
	 *
	 * @return array Format definitions.
	 */
	public static function get_formats() {
		return self::FORMATS;
	}
}
