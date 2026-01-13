<?php
/**
 * Import REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
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
	 * Event participant repository instance.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository                   = new ParticipantRepository();
		$this->event_participant_repository = new EventParticipantRepository();
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

		// POST /fair-audience/v1/import/resolve-duplicates
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/resolve-duplicates',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'resolve_duplicates' ),
					'permission_callback' => array( $this, 'import_permissions_check' ),
					'args'                => array(
						'participants' => array(
							'required'          => true,
							'type'              => 'array',
							'items'             => array(
								'type'       => 'object',
								'properties' => array(
									'name'    => array( 'type' => 'string' ),
									'surname' => array( 'type' => 'string' ),
									'email'   => array( 'type' => 'string' ),
								),
							),
							'validate_callback' => function ( $param ) {
								return is_array( $param );
							},
						),
					),
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

		// Get optional event_id parameter.
		$event_id = $request->get_param( 'event_id' );
		if ( ! empty( $event_id ) ) {
			$event_id = absint( $event_id );
			// Validate that the event exists.
			$event = get_post( $event_id );
			if ( ! $event || 'fair_event' !== $event->post_type ) {
				return new WP_Error(
					'invalid_event',
					__( 'Invalid event ID provided.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		} else {
			$event_id = null;
		}

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
				'imported'        => 0,
				'existing_linked' => 0,
				'skipped'         => 0,
				'errors'          => array(),
				'duplicates'      => array(),
			);

			// First pass: detect duplicate emails within the file.
			$email_rows       = array();
			$duplicate_emails = array();
			$row_count        = count( $data );

			for ( $i = 1; $i < $row_count; $i++ ) {
				$row        = $data[ $i ];
				$row_number = $i + 1;
				$email      = isset( $row[ $email_col ] ) ? trim( (string) $row[ $email_col ] ) : '';

				// Skip empty rows.
				if ( empty( $email ) ) {
					continue;
				}

				// Track which rows use each email.
				if ( ! isset( $email_rows[ $email ] ) ) {
					$email_rows[ $email ] = array();
				}
				$email_rows[ $email ][] = array(
					'row'     => $row_number,
					'name'    => isset( $row[ $name_col ] ) ? trim( (string) $row[ $name_col ] ) : '',
					'surname' => isset( $row[ $surname_col ] ) ? trim( (string) $row[ $surname_col ] ) : '',
				);
			}

			// Identify duplicates (emails used in more than one row).
			foreach ( $email_rows as $email => $rows ) {
				if ( count( $rows ) > 1 ) {
					$duplicate_emails[]      = $email;
					$results['duplicates'][] = array(
						'email' => $email,
						'rows'  => $rows,
						'count' => count( $rows ),
					);
				}
			}

			// Second pass: Process non-duplicate rows.
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

				// Skip rows with duplicate emails (they'll be handled separately).
				if ( in_array( $email, $duplicate_emails, true ) ) {
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
					// Don't create new participant, but link existing to event.
					if ( $event_id ) {
						$link_result = $this->event_participant_repository->add_participant_to_event(
							$event_id,
							$existing->id,
							'signed_up'
						);
						// Only count if relationship was actually created.
						if ( $link_result !== false ) {
							++$results['existing_linked'];
						}
					} else {
						++$results['skipped'];
					}
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

					// If event_id is provided, associate participant with event.
					if ( $event_id ) {
						$link_result = $this->event_participant_repository->add_participant_to_event(
							$event_id,
							$participant->id,
							'signed_up'
						);
						// Log error if linking fails for a newly created participant.
						if ( ! $link_result ) {
							$results['errors'][] = sprintf(
								/* translators: 1: row number, 2: email address */
								__( 'Row %1$d: Failed to link participant to event: %2$s', 'fair-audience' ),
								$row_number,
								$email
							);
						}
					}
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
	 * Resolve duplicate participants by creating them with updated emails.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function resolve_duplicates( $request ) {
		$participants = $request->get_param( 'participants' );

		if ( empty( $participants ) ) {
			return new WP_Error(
				'no_participants',
				__( 'No participants provided.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Get optional event_id parameter.
		$event_id = $request->get_param( 'event_id' );
		if ( ! empty( $event_id ) ) {
			$event_id = absint( $event_id );
			// Validate that the event exists.
			$event = get_post( $event_id );
			if ( ! $event || 'fair_event' !== $event->post_type ) {
				return new WP_Error(
					'invalid_event',
					__( 'Invalid event ID provided.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		} else {
			$event_id = null;
		}

		$results = array(
			'imported'        => 0,
			'existing_linked' => 0,
			'skipped'         => 0,
			'errors'          => array(),
		);

		foreach ( $participants as $index => $participant_data ) {
			// Validate required fields.
			if ( empty( $participant_data['name'] ) || empty( $participant_data['surname'] ) || empty( $participant_data['email'] ) ) {
				$results['errors'][] = sprintf(
					/* translators: %d: participant index */
					__( 'Participant %d: Missing required fields (name, surname, or email)', 'fair-audience' ),
					$index + 1
				);
				continue;
			}

			$name    = sanitize_text_field( $participant_data['name'] );
			$surname = sanitize_text_field( $participant_data['surname'] );
			$email   = sanitize_email( $participant_data['email'] );

			// Validate email format.
			if ( ! is_email( $email ) ) {
				$results['errors'][] = sprintf(
					/* translators: 1: participant index, 2: email address */
					__( 'Participant %1$d: Invalid email format: %2$s', 'fair-audience' ),
					$index + 1,
					$email
				);
				continue;
			}

			// Check if participant already exists.
			$existing = $this->repository->get_by_email( $email );
			if ( $existing ) {
				// Don't create new participant, but link existing to event.
				if ( $event_id ) {
					$link_result = $this->event_participant_repository->add_participant_to_event(
						$event_id,
						$existing->id,
						'signed_up'
					);
					// Only count if relationship was actually created.
					if ( $link_result !== false ) {
						++$results['existing_linked'];
					}
				} else {
					++$results['skipped'];
				}
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

				// If event_id is provided, associate participant with event.
				if ( $event_id ) {
					$link_result = $this->event_participant_repository->add_participant_to_event(
						$event_id,
						$participant->id,
						'signed_up'
					);
					// Log error if linking fails for a newly created participant.
					if ( ! $link_result ) {
						$results['errors'][] = sprintf(
							/* translators: 1: participant index, 2: name and surname */
							__( 'Participant %1$d: Failed to link to event: %2$s', 'fair-audience' ),
							$index + 1,
							$name . ' ' . $surname
						);
					}
				}
			} else {
				$results['errors'][] = sprintf(
					/* translators: 1: participant index, 2: name and surname */
					__( 'Participant %1$d: Failed to save participant: %2$s', 'fair-audience' ),
					$index + 1,
					$name . ' ' . $surname
				);
			}
		}

		return rest_ensure_response( $results );
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
