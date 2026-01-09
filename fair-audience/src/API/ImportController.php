<?php
/**
 * Import REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\Participant;
use PhpOffice\PhpSpreadsheet\IOFactory;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for import operations.
 */
class ImportController extends WP_REST_Controller {

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
	protected $rest_base = 'import';

	/**
	 * Repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// POST /fair-audience/v1/import/entradium
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/entradium',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_entradium' ),
					'permission_callback' => array( $this, 'import_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Import participants from Entradium xlsx file.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function import_entradium( $request ) {
		// Get uploaded files.
		$files = $request->get_file_params();

		if ( empty( $files['file'] ) ) {
			return new WP_Error(
				'no_file',
				__( 'No file uploaded.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		$file = $files['file'];

		// Check for upload errors.
		if ( $file['error'] !== UPLOAD_ERR_OK ) {
			return new WP_Error(
				'upload_error',
				__( 'File upload failed.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Validate file type.
		$allowed_mime_types = array(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'application/vnd.ms-excel',
		);

		if ( ! in_array( $file['type'], $allowed_mime_types, true ) ) {
			return new WP_Error(
				'invalid_file_type',
				__( 'Invalid file type. Please upload an Excel file (.xlsx).', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		try {
			// Load spreadsheet.
			$spreadsheet = IOFactory::load( $file['tmp_name'] );
			$worksheet   = $spreadsheet->getActiveSheet();

			// Get all data as array.
			$data = $worksheet->toArray();

			if ( empty( $data ) ) {
				return new WP_Error(
					'empty_file',
					__( 'The uploaded file is empty.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			// Get headers from first row.
			$headers = $data[0];

			// Find column indices.
			$name_col    = array_search( 'Nombre', $headers, true );
			$surname_col = array_search( 'Apellidos', $headers, true );
			$email_col   = array_search( 'Email', $headers, true );

			if ( false === $name_col || false === $surname_col || false === $email_col ) {
				// Debug: show what headers were found.
				$found_headers = array_filter( $headers );
				return new WP_Error(
					'invalid_format',
					sprintf(
						/* translators: 1: found headers list */
						__( 'Invalid file format. Required columns: Nombre, Apellidos, Email. Found columns: %s', 'fair-audience' ),
						implode( ', ', $found_headers )
					),
					array( 'status' => 400 )
				);
			}

			$results = array(
				'imported' => 0,
				'skipped'  => 0,
				'errors'   => array(),
			);

			// Process data rows (starting from row 2).
			$row_count = count( $data );
			for ( $i = 1; $i < $row_count; $i++ ) {
				$row        = $data[ $i ];
				$row_number = $i + 1;

				// Extract participant data.
				$name    = isset( $row[ $name_col ] ) ? trim( (string) $row[ $name_col ] ) : '';
				$surname = isset( $row[ $surname_col ] ) ? trim( (string) $row[ $surname_col ] ) : '';
				$email   = isset( $row[ $email_col ] ) ? trim( (string) $row[ $email_col ] ) : '';

				// Skip empty rows.
				if ( empty( $name ) && empty( $surname ) && empty( $email ) ) {
					continue;
				}

				// Validate required fields.
				if ( empty( $name ) || empty( $surname ) || empty( $email ) ) {
					$results['errors'][] = sprintf(
						/* translators: %d: row number */
						__( 'Row %d: Missing required fields (name, surname, or email)', 'fair-audience' ),
						$row_number
					);
					continue;
				}

				// Validate email format.
				if ( ! is_email( $email ) ) {
					$results['errors'][] = sprintf(
						/* translators: 1: row number, 2: email address */
						__( 'Row %1$d: Invalid email format: %2$s', 'fair-audience' ),
						$row_number,
						$email
					);
					continue;
				}

				// Check if participant already exists.
				$existing = $this->repository->get_by_email( $email );
				if ( $existing ) {
					++$results['skipped'];
					continue;
				}

				// Create new participant.
				$participant = new Participant();
				$participant->populate(
					array(
						'name'          => $name,
						'surname'       => $surname,
						'email'         => $email,
						'instagram'     => '',
						'email_profile' => 'minimal',
					)
				);

				if ( $participant->save() ) {
					++$results['imported'];
				} else {
					$results['errors'][] = sprintf(
						/* translators: 1: row number, 2: email address */
						__( 'Row %1$d: Failed to save participant: %2$s', 'fair-audience' ),
						$row_number,
						$email
					);
				}
			}

			return rest_ensure_response( $results );

		} catch ( \Exception $e ) {
			return new WP_Error(
				'import_failed',
				sprintf(
					/* translators: %s: error message */
					__( 'Import failed: %s', 'fair-audience' ),
					$e->getMessage()
				),
				array( 'status' => 500 )
			);
		}
	}

	/**
	 * Check permissions for import.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function import_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
