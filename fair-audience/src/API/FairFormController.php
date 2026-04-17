<?php
/**
 * Fair Form REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\ParticipantCategoryRepository;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\QuestionnaireAnswerRepository;
use FairAudience\Models\Participant;
use FairAudience\Models\QuestionnaireSubmission;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for Fair Form submissions.
 */
class FairFormController extends WP_REST_Controller {

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
	protected $rest_base = 'fair-form-submit';

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Questionnaire submission repository instance.
	 *
	 * @var QuestionnaireSubmissionRepository
	 */
	private $submission_repository;

	/**
	 * Questionnaire answer repository instance.
	 *
	 * @var QuestionnaireAnswerRepository
	 */
	private $answer_repository;

	/**
	 * Participant category repository instance.
	 *
	 * @var ParticipantCategoryRepository
	 */
	private $category_repository;

	/**
	 * Token repository instance.
	 *
	 * @var EmailConfirmationTokenRepository
	 */
	private $token_repository;

	/**
	 * Email service instance.
	 *
	 * @var EmailService
	 */
	private $email_service;

	/**
	 * Rate limit: max requests per email per hour.
	 */
	const RATE_LIMIT_MAX = 3;

	/**
	 * Rate limit window in seconds (1 hour).
	 */
	const RATE_LIMIT_WINDOW = 3600;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->participant_repository = new ParticipantRepository();
		$this->submission_repository  = new QuestionnaireSubmissionRepository();
		$this->answer_repository      = new QuestionnaireAnswerRepository();
		$this->category_repository    = new ParticipantCategoryRepository();
		$this->token_repository       = new EmailConfirmationTokenRepository();
		$this->email_service          = new EmailService();
	}

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
					'permission_callback' => '__return_true',
					'args'                => array(
						'name'                  => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname'               => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'                 => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'keep_informed'         => array(
							'type'              => 'boolean',
							'required'          => false,
							'default'           => false,
							'sanitize_callback' => 'rest_sanitize_boolean',
						),
						'event_date_id'         => array(
							'type'     => 'integer',
							'required' => false,
							'default'  => 0,
						),
						'post_id'               => array(
							'type'     => 'integer',
							'required' => false,
							'default'  => 0,
						),
						'mailing_signup'        => array(
							'type'     => array( 'boolean', 'string' ),
							'required' => false,
							'default'  => false,
						),
						// No 'type' declared: WP's rest_sanitize_array() splits strings on
						// /[\s,]+/, which corrupts JSON payloads sent via FormData (spaces
						// inside values get dropped). Let the parse_* helpers handle both
						// raw JSON strings and already-decoded arrays.
						'mailing_category_ids'  => array(
							'required' => false,
							'default'  => array(),
						),
						'questionnaire_answers' => array(
							'required' => false,
							'default'  => array(),
						),
					),
				),
			)
		);
	}

	/**
	 * Allowed MIME types for file uploads.
	 *
	 * @var array
	 */
	const ALLOWED_FILE_TYPES = array(
		'image/jpeg',
		'image/png',
		'image/gif',
		'image/webp',
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	);

	/**
	 * Maximum file size in bytes (20 MB).
	 */
	const MAX_FILE_SIZE = 20 * 1024 * 1024;

	/**
	 * Handle form submission.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$name          = $request->get_param( 'name' );
		$surname       = $request->get_param( 'surname' );
		$email         = $request->get_param( 'email' );
		$keep_informed = $request->get_param( 'keep_informed' );
		$event_date_id = $request->get_param( 'event_date_id' );
		$post_id       = $request->get_param( 'post_id' );

		// Handle questionnaire_answers: may be JSON string when sent via FormData.
		// WP REST API may wrap the string in an array, so check both cases.
		$questionnaire_answers = $request->get_param( 'questionnaire_answers' );
		$questionnaire_answers = $this->parse_questionnaire_answers( $questionnaire_answers );

		// Sanitize each answer.
		$valid_types = array( 'radio', 'checkbox', 'short_text', 'long_text', 'select', 'number', 'date', 'multiselect', 'file_upload', 'phone' );
		$sanitized   = array();
		foreach ( $questionnaire_answers as $answer ) {
			if ( ! is_array( $answer ) ) {
				continue;
			}
			$question_type = in_array( $answer['question_type'] ?? '', $valid_types, true ) ? $answer['question_type'] : 'short_text';
			$answer_value  = sanitize_text_field( $answer['answer_value'] ?? '' );
			$question_text = sanitize_text_field( $answer['question_text'] ?? '' );

			if ( 'phone' === $question_type && '' !== $answer_value && ! preg_match( '/^\+[1-9][0-9]{6,14}$/', $answer_value ) ) {
				return new WP_Error(
					'invalid_phone',
					sprintf(
						/* translators: %s: question text */
						__( 'Please enter a valid phone number with country code (e.g. +49170...) for: %s', 'fair-audience' ),
						$question_text
					),
					array( 'status' => 400 )
				);
			}

			$sanitized[] = array(
				'question_key'  => sanitize_key( $answer['question_key'] ?? '' ),
				'question_text' => $question_text,
				'question_type' => $question_type,
				'answer_value'  => $answer_value,
				'display_order' => (int) ( $answer['display_order'] ?? 0 ),
			);
		}
		$questionnaire_answers = $sanitized;

		// Validate email.
		if ( ! is_email( $email ) ) {
			return new WP_Error(
				'invalid_email',
				__( 'Please enter a valid email address.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check rate limit.
		if ( $this->is_rate_limited( $email ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-audience' ),
				array( 'status' => 429 )
			);
		}

		// Increment rate limit counter.
		$this->increment_rate_limit( $email );

		// Find or create participant.
		$existing = $this->participant_repository->get_by_email( $email );

		if ( $existing ) {
			$participant = $existing;
		} else {
			$participant = new Participant();
			$participant->populate(
				array(
					'name'          => $name,
					'surname'       => $surname,
					'email'         => $email,
					'email_profile' => $keep_informed ? 'marketing' : 'minimal',
					'status'        => 'confirmed',
				)
			);

			if ( ! $participant->save() ) {
				return new WP_Error(
					'creation_failed',
					__( 'Failed to process submission. Please try again.', 'fair-audience' ),
					array( 'status' => 500 )
				);
			}
		}

		// Handle mailing signup if opted in — trigger email confirmation workflow.
		$mailing_signup = $request->get_param( 'mailing_signup' );
		if ( $mailing_signup && '0' !== $mailing_signup ) {
			if ( 'marketing' !== $participant->email_profile ) {
				// Set status to pending until email is confirmed.
				$participant->status = 'pending';
				$participant->save();

				// Create confirmation token and send email.
				$token = $this->token_repository->create_token( $participant->id );
				if ( $token ) {
					$this->email_service->send_confirmation_email( $participant, $token->token );
				}
			}

			// Store pending category selections (applied upon confirmation).
			$mailing_category_ids = $this->parse_mailing_category_ids( $request->get_param( 'mailing_category_ids' ) );
			if ( ! empty( $mailing_category_ids ) ) {
				set_transient(
					'fair_audience_pending_cats_' . $participant->id,
					array_map( 'intval', $mailing_category_ids ),
					48 * HOUR_IN_SECONDS
				);
			}
		}

		// Process file uploads and update answer values with attachment IDs.
		$file_result = $this->process_file_uploads( $request, $questionnaire_answers, $event_date_id, $participant->id );
		if ( is_wp_error( $file_result ) ) {
			return $file_result;
		}
		$questionnaire_answers = $file_result;

		// Save questionnaire answers.
		$this->save_questionnaire_answers( $participant->id, $questionnaire_answers, $event_date_id, $post_id );

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Thank you for your submission!', 'fair-audience' ),
			)
		);
	}

	/**
	 * Process file uploads from the request and update answer values.
	 *
	 * @param WP_REST_Request $request        Request object.
	 * @param array           $answers        Questionnaire answers to update.
	 * @param int             $event_date_id  Optional event date ID to link images to.
	 * @param int             $participant_id Participant ID to set as photo author.
	 * @return array|WP_Error Updated answers array or error.
	 */
	private function process_file_uploads( $request, $answers, $event_date_id = 0, $participant_id = 0 ) {
		$files = $request->get_file_params();
		if ( empty( $files ) ) {
			return $answers;
		}

		// Required for wp_handle_upload().
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		foreach ( $answers as $index => &$answer ) {
			if ( 'file_upload' !== ( $answer['question_type'] ?? '' ) ) {
				continue;
			}

			$file_key = 'fair_form_file_' . ( $answer['question_key'] ?? '' );
			if ( ! isset( $files[ $file_key ] ) ) {
				$answer['answer_value'] = '';
				continue;
			}

			$file = $files[ $file_key ];

			// Validate upload error.
			if ( UPLOAD_ERR_OK !== $file['error'] ) {
				return new WP_Error(
					'upload_error',
					__( 'File upload failed. Please try again.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			// Validate file size.
			if ( $file['size'] > self::MAX_FILE_SIZE ) {
				return new WP_Error(
					'file_too_large',
					__( 'File is too large.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			// Validate MIME type.
			$file_type = wp_check_filetype( $file['name'] );
			if ( empty( $file_type['type'] ) || ! in_array( $file_type['type'], self::ALLOWED_FILE_TYPES, true ) ) {
				return new WP_Error(
					'invalid_file_type',
					__( 'File type not allowed.', 'fair-audience' ),
					array( 'status' => 400 )
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
					$upload['error'],
					array( 'status' => 500 )
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
					__( 'Failed to save uploaded file.', 'fair-audience' ),
					array( 'status' => 500 )
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
			if ( $participant_id > 0 ) {
				$photo_participant_repo = new \FairAudience\Database\PhotoParticipantRepository();
				$photo_participant_repo->set_author( $attachment_id, $participant_id );
			}

			// Store attachment ID as the answer value.
			$answer['answer_value'] = (string) $attachment_id;
		}

		return $answers;
	}

	/**
	 * Save questionnaire answers for a participant.
	 *
	 * @param int   $participant_id Participant ID.
	 * @param array $answers        Questionnaire answers from request.
	 * @param int   $event_date_id  Optional event date ID.
	 * @param int   $post_id        Optional post ID.
	 * @return int Submission ID, or 0 on failure.
	 */
	private function save_questionnaire_answers( $participant_id, $answers, $event_date_id = 0, $post_id = 0 ) {
		$submission_data = array(
			'participant_id' => $participant_id,
			'title'          => __( 'Fair Form', 'fair-audience' ),
		);

		if ( $event_date_id > 0 ) {
			$submission_data['event_date_id'] = $event_date_id;
		}

		if ( $post_id > 0 ) {
			$submission_data['post_id'] = $post_id;
		}

		$submission = new QuestionnaireSubmission();
		$submission->populate( $submission_data );

		if ( ! $submission->save() ) {
			return 0;
		}

		if ( ! empty( $answers ) ) {
			$this->answer_repository->save_answers( $submission->id, $answers );
		}

		return $submission->id;
	}

	/**
	 * Parse mailing_category_ids from various formats.
	 *
	 * When sent via FormData, the IDs arrive as a JSON string.
	 *
	 * @param mixed $raw Raw mailing_category_ids value.
	 * @return array Parsed array of integer category IDs.
	 */
	private function parse_mailing_category_ids( $raw ) {
		if ( is_string( $raw ) ) {
			$decoded = json_decode( $raw, true );
			if ( is_array( $decoded ) ) {
				return array_map( 'intval', $decoded );
			}
			return array();
		}

		if ( is_array( $raw ) ) {
			return array_map( 'intval', $raw );
		}

		return array();
	}

	/**
	 * Parse questionnaire_answers from various formats.
	 *
	 * When sent via FormData, the answers arrive as a JSON string.
	 * When sent via a JSON request body, they arrive as a decoded array.
	 *
	 * @param mixed $raw Raw questionnaire_answers value.
	 * @return array Parsed answers array.
	 */
	private function parse_questionnaire_answers( $raw ) {
		if ( is_string( $raw ) ) {
			$decoded = json_decode( $raw, true );
			return is_array( $decoded ) ? $decoded : array();
		}

		if ( is_array( $raw ) ) {
			return $raw;
		}

		return array();
	}

	/**
	 * Check if email is rate limited.
	 *
	 * @param string $email Email address.
	 * @return bool True if rate limited.
	 */
	private function is_rate_limited( $email ) {
		$transient_key = 'fair_audience_fair_form_' . md5( $email );
		$count         = get_transient( $transient_key );

		return $count && (int) $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment rate limit counter.
	 *
	 * @param string $email Email address.
	 */
	private function increment_rate_limit( $email ) {
		$transient_key = 'fair_audience_fair_form_' . md5( $email );
		$count         = get_transient( $transient_key );

		if ( $count ) {
			set_transient( $transient_key, (int) $count + 1, self::RATE_LIMIT_WINDOW );
		} else {
			set_transient( $transient_key, 1, self::RATE_LIMIT_WINDOW );
		}
	}
}
