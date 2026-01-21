<?php
/**
 * Mailing Signup REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for mailing list signup.
 */
class MailingSignupController extends WP_REST_Controller {

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
	protected $rest_base = 'mailing-signup';

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

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
		$this->token_repository       = new EmailConfirmationTokenRepository();
		$this->email_service          = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// POST /fair-audience/v1/mailing-signup
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'name'    => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'   => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/mailing-signup/confirm
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/confirm',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'confirm_email' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'token' => array(
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
	 * Create signup (submit form).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$name    = $request->get_param( 'name' );
		$surname = $request->get_param( 'surname' );
		$email   = $request->get_param( 'email' );

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

		// Check if email already exists.
		$existing = $this->participant_repository->get_by_email( $email );

		if ( $existing ) {
			// Email exists.
			if ( 'confirmed' === $existing->status ) {
				// Already confirmed.
				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( "You're already subscribed!", 'fair-audience' ),
						'status'  => 'already_subscribed',
					)
				);
			} else {
				// Pending - resend confirmation email.
				$token = $this->token_repository->create_token( $existing->id );

				if ( $token ) {
					$this->email_service->send_confirmation_email( $existing, $token->token );
				}

				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'We sent you another confirmation email. Please check your inbox.', 'fair-audience' ),
						'status'  => 'resent',
					)
				);
			}
		}

		// Create new pending participant.
		$participant = new Participant();
		$participant->populate(
			array(
				'name'    => $name,
				'surname' => $surname,
				'email'   => $email,
				'status'  => 'pending',
			)
		);

		if ( ! $participant->save() ) {
			return new WP_Error(
				'creation_failed',
				__( 'Failed to process signup. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Create confirmation token.
		$token = $this->token_repository->create_token( $participant->id );

		if ( ! $token ) {
			return new WP_Error(
				'token_failed',
				__( 'Failed to process signup. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Send confirmation email.
		$email_sent = $this->email_service->send_confirmation_email( $participant, $token->token );

		if ( ! $email_sent ) {
			return new WP_Error(
				'email_failed',
				__( 'Failed to send confirmation email. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Please check your email to confirm your subscription.', 'fair-audience' ),
				'status'  => 'pending',
			)
		);
	}

	/**
	 * Confirm email via token.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function confirm_email( $request ) {
		$token_string = $request->get_param( 'token' );

		// Get token.
		$token = $this->token_repository->get_by_token( $token_string );

		if ( ! $token ) {
			return new WP_Error(
				'invalid_token',
				__( 'Invalid or expired confirmation link. Please sign up again.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Check if expired.
		if ( $token->is_expired() ) {
			// Delete expired token.
			$token->delete();

			return new WP_Error(
				'token_expired',
				__( 'This confirmation link has expired. Please sign up again.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Get participant.
		$participant = $this->participant_repository->get_by_id( $token->participant_id );

		if ( ! $participant ) {
			// Clean up orphaned token.
			$token->delete();

			return new WP_Error(
				'participant_not_found',
				__( 'Invalid confirmation link. Please sign up again.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Update participant status to confirmed and set email profile to in_the_loop.
		$participant->status        = 'confirmed';
		$participant->email_profile = 'in_the_loop';

		if ( ! $participant->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to confirm subscription. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Delete the token (one-time use).
		$token->delete();

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Your email has been confirmed. Welcome!', 'fair-audience' ),
				'status'  => 'confirmed',
			)
		);
	}

	/**
	 * Check if email is rate limited.
	 *
	 * @param string $email Email address.
	 * @return bool True if rate limited.
	 */
	private function is_rate_limited( $email ) {
		$transient_key = 'fair_audience_signup_' . md5( $email );
		$count         = get_transient( $transient_key );

		return $count && (int) $count >= self::RATE_LIMIT_MAX;
	}

	/**
	 * Increment rate limit counter.
	 *
	 * @param string $email Email address.
	 */
	private function increment_rate_limit( $email ) {
		$transient_key = 'fair_audience_signup_' . md5( $email );
		$count         = get_transient( $transient_key );

		if ( $count ) {
			set_transient( $transient_key, (int) $count + 1, self::RATE_LIMIT_WINDOW );
		} else {
			set_transient( $transient_key, 1, self::RATE_LIMIT_WINDOW );
		}
	}
}
