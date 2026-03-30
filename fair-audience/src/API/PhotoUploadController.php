<?php
/**
 * Photo Upload REST API Controller
 *
 * Handles photo uploads from participants via token authentication.
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\PhotoParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Services\ParticipantToken;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for participant photo uploads.
 *
 * Public endpoint that uses participant tokens for authentication.
 */
class PhotoUploadController extends WP_REST_Controller {

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
	protected $rest_base = 'photo-upload';

	/**
	 * Allowed image MIME types.
	 *
	 * @var array
	 */
	const ALLOWED_FILE_TYPES = array(
		'image/jpeg',
		'image/png',
		'image/gif',
		'image/webp',
	);

	/**
	 * Maximum file size in bytes (20 MB).
	 *
	 * @var int
	 */
	const MAX_FILE_SIZE = 20 * 1024 * 1024;

	/**
	 * Maximum number of files per upload.
	 *
	 * @var int
	 */
	const MAX_FILES = 20;

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Public endpoint; token verified in callback.
					'permission_callback' => '__return_true',
					'args'                => array(
						'participant_token' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Handle photo upload.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function create_item( $request ) {
		// Verify participant token.
		$token      = $request->get_param( 'participant_token' );
		$token_data = ParticipantToken::verify( $token );

		if ( false === $token_data ) {
			return new WP_Error(
				'invalid_token',
				__( 'Invalid or expired link.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		$participant_id = $token_data['participant_id'];
		$event_date_id  = $token_data['event_date_id'];

		// Verify participant exists.
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( $participant_id );

		if ( ! $participant ) {
			return new WP_Error(
				'participant_not_found',
				__( 'Participant not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Get uploaded files.
		$files = $request->get_file_params();
		if ( empty( $files ) ) {
			return new WP_Error(
				'no_files',
				__( 'No files uploaded.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Required for wp_handle_upload().
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$photo_participant_repo = new PhotoParticipantRepository();
		$uploaded_count         = 0;
		$errors                 = array();

		// Process each uploaded file.
		foreach ( $files as $file_key => $file ) {
			if ( $uploaded_count >= self::MAX_FILES ) {
				break;
			}

			// Handle both single file and array of files.
			if ( is_array( $file['name'] ) ) {
				// Multiple files under the same key.
				$file_count = count( $file['name'] );
				for ( $i = 0; $i < $file_count; $i++ ) {
					if ( $uploaded_count >= self::MAX_FILES ) {
						break;
					}

					$single_file = array(
						'name'     => $file['name'][ $i ],
						'type'     => $file['type'][ $i ],
						'tmp_name' => $file['tmp_name'][ $i ],
						'error'    => $file['error'][ $i ],
						'size'     => $file['size'][ $i ],
					);

					$result = $this->process_single_file( $single_file, $participant_id, $event_date_id, $photo_participant_repo );
					if ( is_wp_error( $result ) ) {
						$errors[] = $result->get_error_message();
					} else {
						++$uploaded_count;
					}
				}
			} else {
				// Single file.
				$result = $this->process_single_file( $file, $participant_id, $event_date_id, $photo_participant_repo );
				if ( is_wp_error( $result ) ) {
					$errors[] = $result->get_error_message();
				} else {
					++$uploaded_count;
				}
			}
		}

		if ( 0 === $uploaded_count && ! empty( $errors ) ) {
			return new WP_Error(
				'upload_failed',
				$errors[0],
				array( 'status' => 400 )
			);
		}

		return rest_ensure_response(
			array(
				'success'        => true,
				'uploaded_count' => $uploaded_count,
			)
		);
	}

	/**
	 * Process a single file upload.
	 *
	 * @param array                      $file                   File data from $_FILES.
	 * @param int                        $participant_id         Participant ID.
	 * @param int                        $event_date_id          Event date ID.
	 * @param PhotoParticipantRepository $photo_participant_repo Photo participant repository.
	 * @return int|WP_Error Attachment ID on success, WP_Error on failure.
	 */
	private function process_single_file( $file, $participant_id, $event_date_id, $photo_participant_repo ) {
		// Validate upload error.
		if ( UPLOAD_ERR_OK !== $file['error'] ) {
			return new WP_Error(
				'upload_error',
				__( 'File upload failed.', 'fair-audience' )
			);
		}

		// Validate file size.
		if ( $file['size'] > self::MAX_FILE_SIZE ) {
			return new WP_Error(
				'file_too_large',
				__( 'File is too large.', 'fair-audience' )
			);
		}

		// Validate MIME type.
		$file_type = wp_check_filetype( $file['name'] );
		if ( empty( $file_type['type'] ) || ! in_array( $file_type['type'], self::ALLOWED_FILE_TYPES, true ) ) {
			return new WP_Error(
				'invalid_file_type',
				__( 'Only image files are allowed (JPEG, PNG, GIF, WebP).', 'fair-audience' )
			);
		}

		// Upload file.
		$upload = wp_handle_upload(
			$file,
			array(
				'test_form' => false,
				'test_type' => true,
			)
		);

		if ( isset( $upload['error'] ) ) {
			return new WP_Error(
				'upload_failed',
				$upload['error']
			);
		}

		// Create attachment in media library.
		$attachment_data = array(
			'post_mime_type' => $upload['type'],
			'post_title'     => sanitize_file_name( $file['name'] ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		);

		$attachment_id = wp_insert_attachment( $attachment_data, $upload['file'] );
		if ( is_wp_error( $attachment_id ) ) {
			return new WP_Error(
				'attachment_failed',
				__( 'Failed to save uploaded file.', 'fair-audience' )
			);
		}

		// Generate attachment metadata (thumbnails, etc.).
		$attachment_metadata = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
		wp_update_attachment_metadata( $attachment_id, $attachment_metadata );

		// Link image to event if event_date_id is set and fair-events plugin is active.
		if ( $event_date_id > 0 && class_exists( '\FairEvents\Database\EventPhotoRepository' ) ) {
			$photo_repo = new \FairEvents\Database\EventPhotoRepository();
			$photo_repo->set_event_date( $attachment_id, $event_date_id );
		}

		// Set participant as photo author.
		$photo_participant_repo->set_author( $attachment_id, $participant_id );

		return $attachment_id;
	}
}
