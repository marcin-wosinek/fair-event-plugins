<?php
/**
 * Photo Download REST API Controller
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventPhotoRepository;
use FairEvents\Settings\Settings;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for downloading event photos as ZIP.
 */
class PhotoDownloadController extends WP_REST_Controller {

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
	protected $rest_base = 'events/(?P<event_id>[\d]+)/gallery/download';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'event_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
						'ids'      => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Stream a ZIP file of event photos.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		$event_id = $request->get_param( 'event_id' );

		// Validate event exists.
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

		// Filter by specific IDs if provided.
		$ids_param = $request->get_param( 'ids' );
		if ( ! empty( $ids_param ) ) {
			$requested_ids  = array_map( 'intval', explode( ',', $ids_param ) );
			$attachment_ids = array_intersect( $attachment_ids, $requested_ids );
		}

		if ( empty( $attachment_ids ) ) {
			return new WP_Error(
				'no_photos',
				__( 'No photos to download.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Collect file paths.
		$files = array();
		foreach ( $attachment_ids as $id ) {
			$file_path = get_attached_file( $id );
			if ( $file_path && file_exists( $file_path ) ) {
				$files[] = $file_path;
			}
		}

		if ( empty( $files ) ) {
			return new WP_Error(
				'no_files',
				__( 'No photo files found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		// Create temporary ZIP file.
		$tmp_file = tempnam( sys_get_temp_dir(), 'fair-events-photos' );
		$zip      = new \ZipArchive();

		if ( true !== $zip->open( $tmp_file, \ZipArchive::CREATE | \ZipArchive::OVERWRITE ) ) {
			return new WP_Error(
				'zip_failed',
				__( 'Failed to create ZIP file.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		foreach ( $files as $file_path ) {
			$zip->addFile( $file_path, basename( $file_path ) );
		}

		$zip->close();

		// Stream the ZIP file.
		$event_slug = sanitize_title( $event->post_title );
		$filename   = $event_slug . '-photos.zip';

		header( 'Content-Type: application/zip' );
		header( 'Content-Disposition: attachment; filename="' . $filename . '"' );
		header( 'Content-Length: ' . filesize( $tmp_file ) );
		header( 'Pragma: no-cache' );

		readfile( $tmp_file );
		unlink( $tmp_file );
		exit;
	}
}
