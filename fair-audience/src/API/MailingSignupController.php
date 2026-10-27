<?php
/**
 * Mailing Signup REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\ParticipantCategoryRepository;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Models\Participant;
use FairAudience\Services\AudienceSession;
use FairAudience\Services\EmailService;
use FairAudience\Services\WeeklyFeeds;
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
	 * Participant category repository instance.
	 *
	 * @var ParticipantCategoryRepository
	 */
	private $category_repository;

	/**
	 * Weekly email feeds.
	 *
	 * @var WeeklyFeeds
	 */
	private $weekly_feeds;

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
		$this->category_repository    = new ParticipantCategoryRepository();
		$this->weekly_feeds           = new WeeklyFeeds();
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
						'name'            => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'surname'         => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'email'           => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_email',
							'validate_callback' => function ( $value ) {
								return is_email( $value );
							},
						),
						'category_ids'    => array(
							'type'    => 'array',
							'default' => array(),
							'items'   => array(
								'type' => 'integer',
							),
						),
						// Omitted: the weekly opt-out is left as it is.
						'weekly_summary'  => array(
							'type' => 'boolean',
						),
						// Omitted: the weekly feeds are left as they are. An
						// empty list chooses no feeds, not every feed.
						'weekly_feed_ids' => array(
							'type'  => 'array',
							'items' => array(
								'type' => 'integer',
							),
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
		$name         = $request->get_param( 'name' );
		$surname      = $request->get_param( 'surname' );
		$email        = $request->get_param( 'email' );
		$category_ids = $request->get_param( 'category_ids' ) ?? array();

		// Validate email.
		if ( ! is_email( $email ) ) {
			return new WP_Error(
				'invalid_email',
				__( 'Please enter a valid email address.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Rejected before anything changes, whoever is signing up.
		$weekly_preferences = $this->weekly_preferences( $request );
		if ( array_key_exists( 'feed_ids', $weekly_preferences ) ) {
			$checked = $this->weekly_feeds->resolve_selection( $weekly_preferences['feed_ids'] );
			if ( is_wp_error( $checked ) ) {
				return $checked;
			}
			$weekly_preferences['feed_ids'] = $checked;
		}

		// Logged-in WP users with a linked participant skip the email
		// confirmation dance: we already trust their identity, so just flip
		// the email_profile to marketing and apply category selections. They
		// can only ever change their own linked participant.
		$wp_user_id = get_current_user_id();
		if ( $wp_user_id ) {
			$wp_participant = $this->participant_repository->get_by_user_id( $wp_user_id );
			if ( $wp_participant ) {
				return $this->subscribe_wp_user( $wp_participant, $category_ids, $weekly_preferences );
			}
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
			if ( 'confirmed' === $existing->status && ! empty( $weekly_preferences ) ) {
				// Only the address's owner may change its preferences, so
				// nothing submitted here is applied or kept for later: the
				// owner chooses on the page the emailed link opens.
				EmailService::defer( 'send_manage_subscription_link', array( $existing ) );

				return rest_ensure_response(
					array(
						'success' => true,
						'message' => __( 'This email address is already subscribed. We sent it a link to review and change its email preferences.', 'fair-audience' ),
						'status'  => 'manage_link_sent',
					)
				);
			}

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
				// Pending - resend confirmation email. Weekly preferences wait
				// on the new token and apply only when it confirms.
				$token = $this->token_repository->create_token( $existing->id, $weekly_preferences ? $weekly_preferences : null );

				// Update pending category selections.
				if ( ! empty( $category_ids ) ) {
					set_transient(
						'fair_audience_pending_cats_' . $existing->id,
						array_map( 'intval', $category_ids ),
						48 * HOUR_IN_SECONDS
					);
				}

				if ( $token ) {
					EmailService::defer( 'send_confirmation_email', array( $existing, $token->token ) );
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

		// Create confirmation token. Weekly preferences wait on it and apply
		// only when it confirms.
		$token = $this->token_repository->create_token( $participant->id, $weekly_preferences ? $weekly_preferences : null );

		if ( ! $token ) {
			return new WP_Error(
				'token_failed',
				__( 'Failed to process signup. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Store pending category selections (48 hours, matching token expiry).
		if ( ! empty( $category_ids ) ) {
			set_transient(
				'fair_audience_pending_cats_' . $participant->id,
				array_map( 'intval', $category_ids ),
				48 * HOUR_IN_SECONDS
			);
		}

		// Send confirmation email, deferred to a cron tick so a slow or
		// unreachable mail transport can't make this request time out. The
		// pending participant + token are already persisted, so we report
		// success optimistically; if delivery fails the visitor simply doesn't
		// receive the mail and can sign up again (same outcome as the mail
		// landing in spam). We can no longer surface a send failure here.
		EmailService::defer( 'send_confirmation_email', array( $participant, $token->token ) );

		AudienceSession::set( (int) $participant->id );

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

		// Apply the weekly preferences submitted with this token first, so a
		// failure leaves the token for another try. Feeds that cannot be
		// chosen any more are left out; none is added.
		if ( is_array( $token->pending_preferences ) ) {
			$applied = $this->weekly_feeds->apply( $participant, $token->pending_preferences, false );
			if ( is_wp_error( $applied ) ) {
				return new WP_Error(
					'update_failed',
					__( 'Failed to confirm subscription. Please try again.', 'fair-audience' ),
					array( 'status' => 500 )
				);
			}
		}

		// Update participant status to confirmed and set email profile to marketing.
		$participant->status        = 'confirmed';
		$participant->email_profile = 'marketing';

		if ( ! $participant->save() ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to confirm subscription. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Apply pending category selections.
		$transient_key      = 'fair_audience_pending_cats_' . $participant->id;
		$pending_categories = get_transient( $transient_key );
		if ( is_array( $pending_categories ) && ! empty( $pending_categories ) ) {
			$this->category_repository->set_categories( $participant->id, $pending_categories );
			delete_transient( $transient_key );
		}

		// Delete the token (one-time use).
		$token->delete();

		AudienceSession::set( (int) $participant->id );

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Your email has been confirmed. Welcome!', 'fair-audience' ),
				'status'  => 'confirmed',
			)
		);
	}

	/**
	 * Subscribe a logged-in WP user directly, bypassing the email-confirmation
	 * dance. The user's identity is already trusted by WordPress, so we just
	 * flip email_profile to 'marketing' and apply category selections.
	 *
	 * @param \FairAudience\Models\Participant $participant        Participant linked to the WP user.
	 * @param array                            $category_ids       Selected category IDs.
	 * @param array                            $weekly_preferences Checked weekly preferences; see {@see WeeklyFeeds::apply()}.
	 * @return \WP_REST_Response|\WP_Error
	 */
	private function subscribe_wp_user( $participant, $category_ids, array $weekly_preferences = array() ) {
		$was_marketing = ( 'marketing' === $participant->email_profile && 'confirmed' === $participant->status );

		if ( $weekly_preferences ) {
			$applied = $this->weekly_feeds->apply( $participant, $weekly_preferences );
			if ( is_wp_error( $applied ) ) {
				return $applied;
			}
		}

		if ( ! $was_marketing ) {
			$participant->email_profile = 'marketing';
			$participant->status        = 'confirmed';
			$participant->save();
		}

		if ( ! empty( $category_ids ) ) {
			$this->category_repository->set_categories(
				$participant->id,
				array_map( 'intval', $category_ids )
			);
		}

		if ( $was_marketing && $weekly_preferences ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( 'Your email preferences have been updated.', 'fair-audience' ),
					'status'  => 'preferences_updated',
				)
			);
		}

		if ( $was_marketing ) {
			return rest_ensure_response(
				array(
					'success' => true,
					'message' => __( "You're already subscribed!", 'fair-audience' ),
					'status'  => 'already_subscribed',
				)
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'You have been subscribed.', 'fair-audience' ),
				'status'  => 'confirmed',
			)
		);
	}

	/**
	 * The weekly preferences a request submitted.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return array `weekly_summary` (bool) and `feed_ids` (raw), each only when submitted.
	 */
	private function weekly_preferences( $request ) {
		$preferences = array();
		if ( null !== $request->get_param( 'weekly_summary' ) ) {
			$preferences['weekly_summary'] = (bool) $request->get_param( 'weekly_summary' );
		}
		if ( null !== $request->get_param( 'weekly_feed_ids' ) ) {
			$preferences['feed_ids'] = $request->get_param( 'weekly_feed_ids' );
		}

		return $preferences;
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
