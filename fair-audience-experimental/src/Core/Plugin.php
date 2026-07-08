<?php
/**
 * Plugin core class for Fair Audience Experimental
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_frontend();
		$this->load_hooks();
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairAudienceExperimental\Admin\AdminPages();
			$admin->init();

			if ( Features::is_enabled( 'manage-event-ext' ) ) {
				// Register the Audience/Groups/Mailings tabs on fair-events'
				// manage-event page via its tab-registry filter, rather than
				// fair-events importing this bundle directly. See
				// enqueue_manage_event_ext_assets() for the dependency
				// ordering that avoids a first-render flicker.
				add_action( 'fair_events_manage_event_enqueue_assets', array( $this, 'enqueue_manage_event_ext_assets' ) );
			}
		}
	}

	/**
	 * Enqueue this plugin's manage-event tab extensions (Audience, Groups,
	 * Mailings) on the fair-events manage-event page.
	 *
	 * Declares `fair-events-manage-event` as a script dependency so its
	 * `addFilter()` calls run before the host bundle's `domReady()` mount,
	 * avoiding a first-render flicker where these tabs pop in late.
	 *
	 * @return void
	 */
	public function enqueue_manage_event_ext_assets() {
		$asset_file = include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/manage-event-ext/index.asset.php';

		wp_enqueue_script(
			'fair-audience-experimental-manage-event-ext',
			FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_URL . 'build/admin/manage-event-ext/index.js',
			array_merge( $asset_file['dependencies'], array( 'fair-events-manage-event' ) ),
			$asset_file['version'],
			true
		);

		wp_set_script_translations( 'fair-audience-experimental-manage-event-ext', 'fair-audience-experimental' );
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairAudienceExperimental\Settings\Settings();
		$settings->init();
	}

	/**
	 * Initialize hook-only bundles that don't register admin pages or REST
	 * routes of their own: the media library integration (`galleries`) and
	 * the scheduled-message cron/reschedule hooks (`messaging`).
	 *
	 * @return void
	 */
	private function load_hooks() {
		if ( Features::is_enabled( 'galleries' ) ) {
			\FairAudienceExperimental\Admin\MediaLibraryHooks::init();
			\FairAudienceExperimental\Admin\MediaBatchActions::init();
		}

		if ( Features::is_enabled( 'messaging' ) ) {
			\FairAudienceExperimental\Hooks\ScheduledMessageHooks::init();
		}
	}

	/**
	 * Load and initialize REST API endpoints
	 *
	 * @return void
	 */
	private function load_rest_api() {
		if ( Features::is_enabled( 'fees' ) && class_exists( 'FairPaymentsConnector\Core\Plugin' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\FeesController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'polls' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\PollsController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\PollResponseController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'instagram' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\InstagramController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\InstagramPostsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'collaborators' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\CollaboratorsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'image-templates' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\ImageTemplatesController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'timeline' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\TimelineController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'import' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\ImportController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'groups' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\GroupsController();
					$controller->register_routes();
				}
			);
		}

		// Invitations depend on groups (invitations can target group members)
		// and on the core EmailService for delivery.
		if ( Features::is_enabled( 'invitations' ) && Features::is_enabled( 'groups' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\EventInvitationsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'galleries' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\GalleryAccessController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\PhotoUploadController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\PhotoTagsController();
					$controller->register_routes();
				}
			);
		}

		if ( Features::is_enabled( 'messaging' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\CustomMailController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\ExtraMessagesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairAudienceExperimental\API\ScheduledMessagesController();
					$controller->register_routes();
				}
			);
		}
	}

	/**
	 * Load frontend `template_redirect` handlers and query vars for the
	 * companion's public-facing pages (poll response, fee payment,
	 * collaborator profile).
	 *
	 * @return void
	 */
	private function load_frontend() {
		add_filter(
			'query_vars',
			function ( $vars ) {
				if ( Features::is_enabled( 'polls' ) ) {
					$vars[] = 'poll_key';
				}
				if ( Features::is_enabled( 'fees' ) ) {
					$vars[] = 'fee_payment';
				}
				if ( Features::is_enabled( 'collaborators' ) ) {
					$vars[] = 'collaborator_profile';
				}
				if ( Features::is_enabled( 'galleries' ) ) {
					$vars[] = 'photo_upload';
				}
				return $vars;
			}
		);

		if ( Features::is_enabled( 'polls' ) ) {
			add_action( 'template_redirect', array( $this, 'handle_poll_response' ) );
		}

		if ( Features::is_enabled( 'fees' ) ) {
			add_action( 'template_redirect', array( $this, 'handle_fee_payment' ) );
		}

		if ( Features::is_enabled( 'collaborators' ) ) {
			add_action( 'template_redirect', array( $this, 'handle_collaborator_profile' ) );
		}

		if ( Features::is_enabled( 'galleries' ) ) {
			add_action( 'template_redirect', array( $this, 'handle_photo_upload' ) );
		}

		if ( Features::is_enabled( 'instagram' ) ) {
			add_action( 'fair_audience_refresh_instagram_token', array( $this, 'refresh_instagram_token' ) );
		}
	}

	/**
	 * Handle poll response page requests.
	 *
	 * @return void
	 */
	public function handle_poll_response() {
		$poll_key = get_query_var( 'poll_key' );

		if ( empty( $poll_key ) ) {
			return;
		}

		include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'templates/poll-response.php';
		exit;
	}

	/**
	 * Handle fee payment page requests.
	 *
	 * @return void
	 */
	public function handle_fee_payment() {
		$token = get_query_var( 'fee_payment' );

		if ( empty( $token ) ) {
			return;
		}

		include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'templates/fee-payment.php';
		exit;
	}

	/**
	 * Handle photo upload page requests.
	 *
	 * @return void
	 */
	public function handle_photo_upload() {
		$photo_upload = get_query_var( 'photo_upload' );

		if ( empty( $photo_upload ) ) {
			return;
		}

		include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'templates/photo-upload.php';
		exit;
	}

	/**
	 * Handle collaborator profile registration page requests.
	 *
	 * @return void
	 */
	public function handle_collaborator_profile() {
		$value = get_query_var( 'collaborator_profile' );

		if ( empty( $value ) ) {
			return;
		}

		include FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'templates/collaborator-profile.php';
		exit;
	}

	/**
	 * Refresh Instagram access token via fair-platform OAuth endpoint.
	 *
	 * @return void
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
			error_log( 'Fair Audience Experimental: Instagram token refresh failed: ' . $response->get_error_message() );
			return;
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code || empty( $body['success'] ) ) {
			$error_message = $body['data']['message'] ?? 'Unknown error';
			error_log( "Fair Audience Experimental: Instagram token refresh failed with status {$status_code}: {$error_message}" );
			return;
		}

		$new_token  = $body['data']['access_token'] ?? '';
		$expires_in = $body['data']['expires_in'] ?? 5184000;

		if ( ! empty( $new_token ) ) {
			update_option( 'fair_audience_instagram_access_token', $new_token );
			update_option( 'fair_audience_instagram_token_expires', time() + $expires_in );
			error_log( 'Fair Audience Experimental: Instagram token refreshed successfully.' );
		}
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation.
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning.
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization.
	}
}
