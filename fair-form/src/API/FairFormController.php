<?php
/**
 * Fair Form REST API Controller
 *
 * @package FairForm
 */

namespace FairForm\API;

use FairForm\Services\QuestionnaireService;
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
	protected $namespace = 'fair-form/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'fair-form-submit';

	/**
	 * Questionnaire service instance.
	 *
	 * @var QuestionnaireService
	 */
	private $questionnaire_service;

	/**
	 * Rate limit: max requests per identifier per hour.
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
		$this->questionnaire_service = new QuestionnaireService();
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
					// Public endpoint: anonymous form submissions are allowed.
					'permission_callback' => '__return_true',
					'args'                => array(
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
						'notification_email'    => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_email',
						),
						'form_id'               => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'form_title'            => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Handle form submission.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$event_date_id = $request->get_param( 'event_date_id' );
		$post_id       = $request->get_param( 'post_id' );

		// Parse and sanitize questionnaire_answers (may be a JSON string when sent via FormData).
		$questionnaire_answers = $this->questionnaire_service->parse_answers(
			$request->get_param( 'questionnaire_answers' )
		);
		$questionnaire_answers = $this->questionnaire_service->sanitize_answers( $questionnaire_answers );
		if ( is_wp_error( $questionnaire_answers ) ) {
			return $questionnaire_answers;
		}

		// Extract email from questionnaire answers (question_type='email'), if present.
		$email = $this->extract_email_from_answers( $questionnaire_answers );

		// Apply rate limiting keyed on email when available, IP address as fallback.
		$rate_limit_key = $this->get_rate_limit_key( $email );
		if ( $this->is_rate_limited( $rate_limit_key ) ) {
			return new WP_Error(
				'rate_limited',
				__( 'Too many requests. Please try again later.', 'fair-form' ),
				array( 'status' => 429 )
			);
		}
		$this->increment_rate_limit( $rate_limit_key );

		// Participant creation is an opt-in enhancement: only run when
		// fair-audience is active AND an email field was submitted.
		$participant    = null;
		$participant_id = null;

		if ( null !== $email
			&& class_exists( '\FairAudience\Database\ParticipantRepository' )
			&& class_exists( '\FairAudience\Models\Participant' ) ) {
			$participant_repo = new \FairAudience\Database\ParticipantRepository();
			$existing         = $participant_repo->get_by_email( $email );

			if ( $existing ) {
				$participant = $existing;
			} else {
				$participant = new \FairAudience\Models\Participant();
				$participant->populate(
					array(
						'email'         => $email,
						'email_profile' => 'minimal',
						'status'        => 'confirmed',
					)
				);

				if ( ! $participant->save() ) {
					return new WP_Error(
						'creation_failed',
						__( 'Failed to process submission. Please try again.', 'fair-form' ),
						array( 'status' => 500 )
					);
				}
			}

			$participant_id = $participant->id;
		}

		// Handle mailing signup if opted in — trigger email confirmation workflow.
		$mailing_signup = $request->get_param( 'mailing_signup' );
		if ( null !== $participant && $mailing_signup && '0' !== $mailing_signup
			&& class_exists( '\FairAudience\Database\EmailConfirmationTokenRepository' )
			&& class_exists( '\FairAudience\Services\EmailService' ) ) {
			if ( 'marketing' !== $participant->email_profile ) {
				// Set status to pending until email is confirmed.
				$participant->status = 'pending';
				$participant->save();

				// Create confirmation token and send email (deferred so a slow
				// mail transport can't make this request time out).
				$token_repo = new \FairAudience\Database\EmailConfirmationTokenRepository();
				$token      = $token_repo->create_token( $participant->id );
				if ( $token ) {
					\FairAudience\Services\EmailService::defer( 'send_confirmation_email', array( $participant, $token->token ) );
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
		$file_result = $this->questionnaire_service->process_file_uploads( $request, $questionnaire_answers, $event_date_id, $participant_id );
		if ( is_wp_error( $file_result ) ) {
			return $file_result;
		}
		$questionnaire_answers = $file_result;

		// Save questionnaire answers (participant_id may be null for anonymous submissions).
		$this->questionnaire_service->save_answers(
			$participant_id,
			$questionnaire_answers,
			$event_date_id,
			$post_id,
			__( 'Fair Form', 'fair-form' ),
			false,
			$request->get_param( 'form_id' ),
			$request->get_param( 'form_title' )
		);

		// Send confirmation email to the submitter when participant exists (deferred).
		if ( null !== $participant && class_exists( '\FairAudience\Services\EmailService' ) ) {
			\FairAudience\Services\EmailService::defer(
				'send_form_confirmation',
				array( $participant, $questionnaire_answers, $post_id )
			);

			// Send admin notification email if configured (also deferred).
			$notification_email = $request->get_param( 'notification_email' );
			if ( ! empty( $notification_email ) && is_email( $notification_email ) ) {
				\FairAudience\Services\EmailService::defer(
					'send_form_notification',
					array( $notification_email, '', '', $email ?? '', $questionnaire_answers, $post_id )
				);
			}
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Thank you for your submission!', 'fair-form' ),
			)
		);
	}

	/**
	 * Extract the first email value from questionnaire answers.
	 *
	 * @param array $answers Sanitized questionnaire answers.
	 * @return string|null Email string, or null if no email answer present.
	 */
	private function extract_email_from_answers( $answers ) {
		foreach ( $answers as $answer ) {
			if ( 'email' === ( $answer['question_type'] ?? '' ) && ! empty( $answer['answer_value'] ) ) {
				return sanitize_email( $answer['answer_value'] );
			}
		}
		return null;
	}

	/**
	 * Build the transient key used for rate limiting.
	 *
	 * Keys on email when available; falls back to hashed IP address.
	 *
	 * @param string|null $email Submitter email, or null.
	 * @return string Transient key.
	 */
	private function get_rate_limit_key( $email ) {
		if ( null !== $email && '' !== $email ) {
			return 'fair_form_submit_' . md5( $email );
		}

		// Best-effort IP-based fallback when no email field is present.
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		return 'fair_form_submit_ip_' . md5( $ip );
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
	 * Check if a rate-limit key is exhausted.
	 *
	 * @param string $key Transient key.
	 * @return bool True if rate limited.
	 */
	private function is_rate_limited( $key ) {
		$count = get_transient( $key );
		return $count && (int) $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment the rate-limit counter for a key.
	 *
	 * @param string $key Transient key.
	 */
	private function increment_rate_limit( $key ) {
		$count = get_transient( $key );

		if ( $count ) {
			set_transient( $key, (int) $count + 1, self::RATE_LIMIT_WINDOW );
		} else {
			set_transient( $key, 1, self::RATE_LIMIT_WINDOW );
		}
	}
}
