<?php
/**
 * Core Plugin Class
 *
 * @package FairAudience
 */

namespace FairAudience\Core;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class (singleton).
 */
class Plugin {

	/**
	 * Singleton instance.
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance.
	 *
	 * @return Plugin
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Private constructor to prevent direct instantiation.
	 */
	private function __construct() {
		// Private constructor.
	}

	/**
	 * Initialize the plugin.
	 */
	public function init() {
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-audience', false, 'fair-audience/languages' );
				}
			}
		);

		add_action( 'rest_api_init', array( $this, 'register_api_endpoints' ) );
		add_filter( 'rest_post_dispatch', array( $this, 'slide_audience_session_cookie' ), 10, 3 );
		add_action( 'init', array( $this, 'sync_audience_session_with_logged_in_user' ), 20 );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'template_redirect', array( $this, 'handle_poll_response' ) );
		add_action( 'template_redirect', array( $this, 'handle_email_confirmation' ) );
		add_action( 'template_redirect', array( $this, 'handle_manage_subscription' ) );
		add_action( 'template_redirect', array( $this, 'handle_collaborator_profile' ) );
		add_action( 'template_redirect', array( $this, 'handle_fee_payment' ) );
		add_action( 'template_redirect', array( $this, 'handle_photo_upload' ) );
		add_action( 'template_redirect', array( $this, 'handle_unsubscribe_event_interest' ) );

		// Instagram token refresh cron.
		add_action( 'fair_audience_refresh_instagram_token', array( $this, 'refresh_instagram_token' ) );

		// Deferred email dispatch: confirmation emails are scheduled rather than
		// sent inline so a slow/unreachable mail transport can't make signup
		// requests time out. See EmailService::defer().
		add_action(
			\FairAudience\Services\EmailService::DEFERRED_EMAIL_HOOK,
			array( \FairAudience\Services\EmailService::class, 'run_deferred' ),
			10,
			2
		);

		// Initialize settings.
		$settings = new \FairAudience\Settings\Settings();
		$settings->init();

		// Shared REST API endpoints (block renderer).
		new \FairEventsShared\API\RestHooks();

		// Initialize admin.
		$admin_hooks = new \FairAudience\Admin\AdminHooks();

		// Initialize media library integration.
		\FairAudience\Admin\MediaLibraryHooks::init();
		\FairAudience\Admin\MediaBatchActions::init();

		// Initialize SVG upload support.
		\FairAudience\Hooks\SvgUploadHooks::init();

		// Initialize payment hooks (for fair-payments-connector webhook integration).
		\FairAudience\Hooks\PaymentHooks::init();
		\FairAudience\Hooks\ScheduledMessageHooks::init();

		// Initialize blocks.
		$block_hooks = new \FairAudience\Hooks\BlockHooks();
	}

	/**
	 * Register REST API endpoints.
	 */
	public function register_api_endpoints() {
		$participants_controller = new \FairAudience\API\ParticipantsController();
		$participants_controller->register_routes();

		$event_participants_controller = new \FairAudience\API\EventParticipantsController();
		$event_participants_controller->register_routes();

		$import_controller = new \FairAudience\API\ImportController();
		$import_controller->register_routes();

		$polls_controller = new \FairAudience\API\PollsController();
		$polls_controller->register_routes();

		$poll_response_controller = new \FairAudience\API\PollResponseController();
		$poll_response_controller->register_routes();

		$gallery_access_controller = new \FairAudience\API\GalleryAccessController();
		$gallery_access_controller->register_routes();

		$mailing_signup_controller = new \FairAudience\API\MailingSignupController();
		$mailing_signup_controller->register_routes();

		$collaborators_controller = new \FairAudience\API\CollaboratorsController();
		$collaborators_controller->register_routes();

		$groups_controller = new \FairAudience\API\GroupsController();
		$groups_controller->register_routes();

		$event_signup_controller = new \FairAudience\API\EventSignupController();
		$event_signup_controller->register_routes();

		$audience_signup_controller = new \FairAudience\API\AudienceSignupController();
		$audience_signup_controller->register_routes();

		$event_invitations_controller = new \FairAudience\API\EventInvitationsController();
		$event_invitations_controller->register_routes();

		$instagram_controller = new \FairAudience\API\InstagramController();
		$instagram_controller->register_routes();

		$instagram_posts_controller = new \FairAudience\API\InstagramPostsController();
		$instagram_posts_controller->register_routes();

		$image_templates_controller = new \FairAudience\API\ImageTemplatesController();
		$image_templates_controller->register_routes();

		$extra_messages_controller = new \FairAudience\API\ExtraMessagesController();
		$extra_messages_controller->register_routes();

		$custom_mail_controller = new \FairAudience\API\CustomMailController();
		$custom_mail_controller->register_routes();

		$scheduled_messages_controller = new \FairAudience\API\ScheduledMessagesController();
		$scheduled_messages_controller->register_routes();

		$questionnaire_responses_controller = new \FairAudience\API\QuestionnaireResponsesController();
		$questionnaire_responses_controller->register_routes();

		$fair_form_controller = new \FairAudience\API\FairFormController();
		$fair_form_controller->register_routes();

		$photo_tags_controller = new \FairAudience\API\PhotoTagsController();
		$photo_tags_controller->register_routes();

		$photo_upload_controller = new \FairAudience\API\PhotoUploadController();
		$photo_upload_controller->register_routes();

		$timeline_controller = new \FairAudience\API\TimelineController();
		$timeline_controller->register_routes();

		$session_controller = new \FairAudience\API\SessionController();
		$session_controller->register_routes();

		$event_interest_controller = new \FairAudience\API\EventInterestController();
		$event_interest_controller->register_routes();

		// Membership fees (only when fair-payments-connector plugin is active).
		if ( class_exists( 'FairPaymentsConnector\Core\Plugin' ) ) {
			$fees_controller = new \FairAudience\API\FeesController();
			$fees_controller->register_routes();
		}
	}

	/**
	 * Slide the audience session cookie forward on every successful
	 * fair-audience REST request that carried a valid session cookie.
	 *
	 * Hooked into rest_post_dispatch so it runs after the route handler.
	 * Skipped when the response is an error or for routes outside the
	 * fair-audience namespace.
	 *
	 * @param \WP_HTTP_Response $response Response object.
	 * @param \WP_REST_Server   $server   REST server instance.
	 * @param \WP_REST_Request  $request  Request object.
	 * @return \WP_HTTP_Response Unmodified response.
	 */
	public function slide_audience_session_cookie( $response, $server, $request ) {
		if ( ! $response instanceof \WP_HTTP_Response ) {
			return $response;
		}
		if ( ! $request instanceof \WP_REST_Request ) {
			return $response;
		}

		$route = $request->get_route();
		if ( 0 !== strpos( $route, '/fair-audience/' ) ) {
			return $response;
		}

		$status = $response->get_status();
		if ( $status < 200 || $status >= 300 ) {
			return $response;
		}

		\FairAudience\Services\AudienceSession::slide();

		return $response;
	}

	/**
	 * Keep the audience session cookie in sync with the logged-in WP user.
	 *
	 * A logged-in user's wp_user_id link is a stronger identity than the
	 * cookie, so when both are present and disagree the cookie is reissued
	 * to match the WP-linked participant. When the user is not logged in,
	 * or has no linked participant, the cookie is left alone.
	 *
	 * Runs on init priority 20 (after WP sets the current user) so that
	 * setcookie() runs before any output.
	 *
	 * @return void
	 */
	public function sync_audience_session_with_logged_in_user() {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return;
		}

		$repository         = new \FairAudience\Database\ParticipantRepository();
		$linked_participant = $repository->get_by_user_id( $user_id );
		if ( ! $linked_participant ) {
			return;
		}

		$linked_id = (int) $linked_participant->id;
		$cookie_id = \FairAudience\Services\AudienceSession::get_participant_id();

		if ( $linked_id === $cookie_id ) {
			return;
		}

		\FairAudience\Services\AudienceSession::set( $linked_id );
	}

	/**
	 * Add custom query variables.
	 *
	 * @param array $vars Array of query variables.
	 * @return array Modified array of query variables.
	 */
	public function add_query_vars( $vars ) {
		$vars[] = 'poll_key';
		$vars[] = 'gallery_key';
		$vars[] = 'confirm_email_key';
		$vars[] = 'participant_token';
		$vars[] = 'manage_subscription';
		$vars[] = 'collaborator_profile';
		$vars[] = 'fee_payment';
		$vars[] = 'edit_audience_signup';
		$vars[] = 'photo_upload';
		$vars[] = 'invitation';
		$vars[] = 'unsubscribe_event_interest';
		return $vars;
	}

	/**
	 * Handle one-click unsubscribe from event-interest signups.
	 *
	 * Triggered by the tokenized link in the confirmation email
	 * (`?unsubscribe_event_interest=1&token=…`). Validates the token, removes
	 * the EventParticipant row when it still carries the 'interested' label,
	 * and renders a thank-you page. A relationship that has been upgraded to
	 * signed_up / collaborator is preserved.
	 */
	public function handle_unsubscribe_event_interest() {
		$flag = get_query_var( 'unsubscribe_event_interest' );

		if ( empty( $flag ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Authorization is the signed token below.
		$token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';

		if ( empty( $token ) ) {
			wp_die(
				esc_html__( 'Missing unsubscribe token.', 'fair-audience' ),
				esc_html__( 'Unsubscribe', 'fair-audience' ),
				array( 'response' => 400 )
			);
		}

		$parsed = \FairAudience\Services\ParticipantToken::verify( $token );

		if ( ! $parsed ) {
			wp_die(
				esc_html__( 'This unsubscribe link is invalid or has expired.', 'fair-audience' ),
				esc_html__( 'Unsubscribe', 'fair-audience' ),
				array( 'response' => 400 )
			);
		}

		$repository   = new \FairAudience\Database\EventParticipantRepository();
		$relationship = $repository->get_by_event_date_and_participant(
			$parsed['event_date_id'],
			$parsed['participant_id']
		);

		if ( $relationship && 'interested' === $relationship->label ) {
			$relationship->delete();
		}

		wp_die(
			esc_html__( 'You will no longer receive updates about this event.', 'fair-audience' ),
			esc_html__( 'Unsubscribed', 'fair-audience' ),
			array( 'response' => 200 )
		);
	}

	/**
	 * Handle poll response page requests.
	 */
	public function handle_poll_response() {
		$poll_key = get_query_var( 'poll_key' );

		if ( empty( $poll_key ) ) {
			return;
		}

		// Load poll template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/poll-response.php';
		exit;
	}

	/**
	 * Handle email confirmation page requests.
	 */
	public function handle_email_confirmation() {
		$confirm_key = get_query_var( 'confirm_email_key' );

		if ( empty( $confirm_key ) ) {
			return;
		}

		// Load email confirmation template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/email-confirmation.php';
		exit;
	}

	/**
	 * Handle manage subscription page requests.
	 */
	public function handle_manage_subscription() {
		$token = get_query_var( 'manage_subscription' );

		if ( empty( $token ) ) {
			return;
		}

		// Load manage subscription template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/manage-subscription.php';
		exit;
	}

	/**
	 * Refresh Instagram access token via fair-platform OAuth endpoint.
	 */
	public function refresh_instagram_token() {
		$access_token = get_option( 'fair_audience_instagram_access_token', '' );
		$expires      = (int) get_option( 'fair_audience_instagram_token_expires', 0 );

		// Skip if no token configured.
		if ( empty( $access_token ) ) {
			return;
		}

		// Skip if token expiry is more than 7 days away.
		if ( $expires > 0 && ( $expires - time() ) > 7 * DAY_IN_SECONDS ) {
			return;
		}

		$response = wp_remote_post(
			'https://fair-event-plugins.com/oauth/instagram/refresh',
			array(
				'timeout' => 30,
				'body'    => array(
					'access_token' => $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Fair Audience: Instagram token refresh failed: ' . $response->get_error_message() );
			return;
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code || empty( $body['success'] ) ) {
			$error_message = $body['data']['message'] ?? 'Unknown error';
			error_log( "Fair Audience: Instagram token refresh failed with status {$status_code}: {$error_message}" );
			return;
		}

		$new_token  = $body['data']['access_token'] ?? '';
		$expires_in = $body['data']['expires_in'] ?? 5184000;

		if ( ! empty( $new_token ) ) {
			update_option( 'fair_audience_instagram_access_token', $new_token );
			update_option( 'fair_audience_instagram_token_expires', time() + $expires_in );
			error_log( 'Fair Audience: Instagram token refreshed successfully.' );
		}
	}

	/**
	 * Handle fee payment page requests.
	 */
	public function handle_fee_payment() {
		$token = get_query_var( 'fee_payment' );

		if ( empty( $token ) ) {
			return;
		}

		// Load fee payment template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/fee-payment.php';
		exit;
	}

	/**
	 * Handle photo upload page requests.
	 */
	public function handle_photo_upload() {
		$photo_upload = get_query_var( 'photo_upload' );

		if ( empty( $photo_upload ) ) {
			return;
		}

		// Load photo upload template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/photo-upload.php';
		exit;
	}

	/**
	 * Handle collaborator profile registration page requests.
	 */
	public function handle_collaborator_profile() {
		$value = get_query_var( 'collaborator_profile' );

		if ( empty( $value ) ) {
			return;
		}

		// Load collaborator profile template.
		include FAIR_AUDIENCE_PLUGIN_DIR . 'templates/collaborator-profile.php';
		exit;
	}
}
