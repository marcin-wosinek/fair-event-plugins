<?php
/**
 * Participant migration REST API controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Services\AudienceMigration;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Exports the audience as CSV and imports such a file (#2218).
 *
 * Both routes hold personal data, so they need `manage_options`. Nothing is
 * stored as a file: the export is returned in the response body, and the
 * upload is read from PHP's temporary upload file, which PHP deletes after
 * the request.
 */
class ParticipantMigrationController extends WP_REST_Controller {

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
	protected $rest_base = 'participants';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/participants/export.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/export',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'export' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		// POST /fair-audience/v1/participants/import (multipart, field "file").
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);
	}

	/**
	 * Only administrators can move audience data between sites.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error
	 */
	public function permissions_check( $request ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- WP_REST_Controller signature.
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'Only administrators can export or import the audience.', 'fair-audience' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * Export every participant, whatever the admin table shows.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function export( $request ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- WP_REST_Controller signature.
		$participants = ( new ParticipantRepository() )->get_all( 'id', 'ASC' );

		return $this->private_response(
			array(
				'filename' => 'fair-audience-' . gmdate( 'Y-m-d' ) . '.csv',
				'count'    => count( $participants ),
				'content'  => AudienceMigration::export_csv( $participants ),
			)
		);
	}

	/**
	 * Import an uploaded CSV file.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import( $request ) {
		$files = $request->get_file_params();
		$file  = $files['file'] ?? null;

		if ( ! is_array( $file ) || empty( $file['tmp_name'] ) || ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) === UPLOAD_ERR_NO_FILE ) {
			return new WP_Error( 'no_file', __( 'Choose a CSV file to import.', 'fair-audience' ), array( 'status' => 400 ) );
		}

		if ( in_array( $file['error'], array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) || (int) $file['size'] > AudienceMigration::MAX_BYTES ) {
			return new WP_Error( 'file_too_large', __( 'The file is larger than 5 MB. Split it into smaller files and import each one.', 'fair-audience' ), array( 'status' => 413 ) );
		}

		if ( UPLOAD_ERR_OK !== $file['error'] || ! is_uploaded_file( $file['tmp_name'] ) ) {
			return new WP_Error( 'upload_error', __( 'The file could not be uploaded. Try again.', 'fair-audience' ), array( 'status' => 400 ) );
		}

		if ( 'csv' !== strtolower( pathinfo( (string) ( $file['name'] ?? '' ), PATHINFO_EXTENSION ) ) ) {
			return new WP_Error( 'invalid_file_type', __( 'Choose a .csv file exported from Fair Audience.', 'fair-audience' ), array( 'status' => 400 ) );
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- reading PHP's temporary upload, not a remote URL.
		$text = file_get_contents( $file['tmp_name'] );
		if ( false === $text ) {
			return new WP_Error( 'upload_error', __( 'The file could not be uploaded. Try again.', 'fair-audience' ), array( 'status' => 400 ) );
		}

		$outcome = ( new AudienceMigration() )->import( $text );
		if ( $outcome['error'] ) {
			return new WP_Error( $outcome['error']['code'], $outcome['error']['message'], array( 'status' => 400 ) );
		}

		return $this->private_response( $outcome['result'] );
	}

	/**
	 * A response that browsers and proxies must not store.
	 *
	 * @param array $data Response data.
	 * @return WP_REST_Response
	 */
	private function private_response( array $data ) {
		$response = new WP_REST_Response( $data, 200 );
		$response->header( 'Cache-Control', 'no-store, private' );
		return $response;
	}
}
