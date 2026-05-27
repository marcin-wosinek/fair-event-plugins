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
use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use FairAudience\Services\QuestionnaireService;
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
	 * Questionnaire service instance.
	 *
	 * @var QuestionnaireService
	 */
	private $questionnaire_service;

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
		$this->questionnaire_service  = new QuestionnaireService();
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
						'notification_email'    => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => '',
							'sanitize_callback' => 'sanitize_email',
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
		$name          = $request->get_param( 'name' );
		$surname       = $request->get_param( 'surname' );
		$email         = $request->get_param( 'email' );
		$keep_informed = $request->get_param( 'keep_informed' );
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

				// Create confirmation token and send email (deferred so a slow
				// mail transport can't make this request time out).
				$token = $this->token_repository->create_token( $participant->id );
				if ( $token ) {
					EmailService::defer( 'send_confirmation_email', array( $participant, $token->token ) );
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
		$file_result = $this->questionnaire_service->process_file_uploads( $request, $questionnaire_answers, $event_date_id, $participant->id );
		if ( is_wp_error( $file_result ) ) {
			return $file_result;
		}
		$questionnaire_answers = $file_result;

		// Save questionnaire answers.
		$this->questionnaire_service->save_answers(
			$participant->id,
			$questionnaire_answers,
			$event_date_id,
			$post_id,
			__( 'Fair Form', 'fair-audience' )
		);

		// Send confirmation email to the submitter (deferred so a slow mail
		// transport can't make this request time out).
		EmailService::defer(
			'send_form_confirmation',
			array( $participant, $questionnaire_answers, $post_id )
		);

		// Send admin notification email if configured (also deferred).
		$notification_email = $request->get_param( 'notification_email' );
		if ( ! empty( $notification_email ) && is_email( $notification_email ) ) {
			EmailService::defer(
				'send_form_notification',
				array( $notification_email, $name, $surname, $email, $questionnaire_answers, $post_id )
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Thank you for your submission!', 'fair-audience' ),
			)
		);
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
