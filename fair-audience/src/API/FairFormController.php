<?php
/**
 * Fair Form REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\QuestionnaireAnswerRepository;
use FairAudience\Models\Participant;
use FairAudience\Models\QuestionnaireSubmission;
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
						'questionnaire_answers' => array(
							'type'     => 'array',
							'required' => false,
							'default'  => array(),
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'question_key'  => array(
										'type'     => 'string',
										'required' => true,
										'sanitize_callback' => 'sanitize_key',
									),
									'question_text' => array(
										'type'     => 'string',
										'required' => true,
										'sanitize_callback' => 'sanitize_text_field',
									),
									'question_type' => array(
										'type'     => 'string',
										'required' => true,
										'enum'     => array( 'radio', 'checkbox', 'short_text', 'long_text', 'select', 'number', 'date', 'multiselect' ),
									),
									'answer_value'  => array(
										'type'     => 'string',
										'required' => true,
										'sanitize_callback' => 'sanitize_text_field',
									),
									'display_order' => array(
										'type'     => 'integer',
										'required' => true,
									),
								),
							),
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
		$name                  = $request->get_param( 'name' );
		$surname               = $request->get_param( 'surname' );
		$email                 = $request->get_param( 'email' );
		$keep_informed         = $request->get_param( 'keep_informed' );
		$questionnaire_answers = $request->get_param( 'questionnaire_answers' );
		$event_date_id         = $request->get_param( 'event_date_id' );
		$post_id               = $request->get_param( 'post_id' );

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
