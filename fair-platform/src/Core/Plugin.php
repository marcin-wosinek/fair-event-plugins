<?php
/**
 * Main Plugin Class
 *
 * @package FairPlatform
 */

namespace FairPlatform\Core;

use FairPlatform\Database\Schema;
use FairPlatform\Database\ConnectionRepository;
use FairPlatform\Database\InstagramConnectionRepository;
use FairPlatform\API\ConnectionsController;
use FairPlatform\API\HealthController;
use FairPlatform\API\InstagramConnectionsController;
use FairPlatform\API\InstagramHandoffController;
use FairPlatform\Monitoring\OAuthErrorReporter;
use FairPlatform\Monitoring\SafeEvent;
use FairPlatform\OAuth\InstagramMetaClient;
use FairPlatform\OAuth\InstagramOAuthException;
use FairPlatform\OAuth\InstagramUnifiedLogin;
use FairPlatform\OAuth\MollieOAuth;
use FairPlatform\OAuth\OneTimeStore;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class
 */
class Plugin {
	/**
	 * Store of Instagram authorization attempts, keyed by their state.
	 */
	const INSTAGRAM_STATE_STORE = 'ig_state';

	/**
	 * Singleton instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

	/**
	 * Error reporter for the Mollie OAuth flows, created on first use.
	 *
	 * @var OAuthErrorReporter|null
	 */
	private $error_reporter = null;

	/**
	 * Get singleton instance
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
	 * Constructor
	 */
	private function __construct() {
		$this->check_requirements();
		$this->init_hooks();
	}

	/**
	 * Check plugin requirements
	 *
	 * @return void
	 */
	private function check_requirements() {
		// Check for required constants.
		if ( ! defined( 'MOLLIE_CLIENT_ID' ) || ! defined( 'MOLLIE_CLIENT_SECRET' ) ) {
			add_action( 'admin_notices', array( $this, 'missing_credentials_notice' ) );
			return;
		}

		// Check for Mollie PHP library.
		if ( ! class_exists( '\Mollie\Api\MollieApiClient' ) ) {
			add_action( 'admin_notices', array( $this, 'missing_library_notice' ) );
			return;
		}

		// Check for Instagram credentials (non-blocking - Instagram is additive).
		if ( null === InstagramUnifiedLogin::config() ) {
			add_action( 'admin_notices', array( $this, 'missing_instagram_credentials_notice' ) );
		}
	}

	/**
	 * Initialize WordPress hooks
	 *
	 * @return void
	 */
	private function init_hooks() {
		// Default: rely on WordPress.org language packs. The `bundled-translations`
		// feature flag opts into loading the .mo files we ship in `languages/`.
		add_action(
			'init',
			function () {
				if ( Features::is_enabled( 'bundled-translations' ) ) {
					load_plugin_textdomain( 'fair-platform', false, 'fair-platform/languages' );
				}
			}
		);

		// Register feature flag option (used by Features admin page).
		add_action(
			'admin_init',
			function () {
				register_setting(
					'fair_platform_settings',
					Features::OPTION,
					array(
						'type'              => 'object',
						'sanitize_callback' => array( Features::class, 'sanitize_option' ),
						'default'           => array(),
					)
				);
			}
		);

		// Check for database updates.
		if ( Schema::needs_update() ) {
			Schema::create_tables();
		}

		// Register rewrite rules for OAuth endpoints.
		add_action( 'init', array( $this, 'register_rewrite_rules' ) );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'template_redirect', array( $this, 'handle_oauth_endpoints' ) );

		// Register REST API endpoints.
		add_action( 'rest_api_init', array( $this, 'register_rest_api' ) );

		// Initialize admin interface.
		$this->init_admin();

		$this->load_shared_settings_page();
	}

	/**
	 * Boot the shared central "Fair Event Plugins" settings screen and
	 * register this plugin's bundled-translations row on it.
	 *
	 * @return void
	 */
	private function load_shared_settings_page() {
		if ( ! is_admin() ) {
			return;
		}

		if ( class_exists( '\FairEventsShared\Admin\SettingsPage' ) ) {
			\FairEventsShared\Admin\SettingsPage::boot();
		}

		add_filter( 'fair_event_plugins_settings_fields', array( $this, 'register_shared_settings_fields' ) );
	}

	/**
	 * Register this plugin's bundled-translations row on the shared screen.
	 *
	 * @param array $fields Field descriptors collected so far.
	 * @return array Field descriptors with this plugin's row appended.
	 */
	public function register_shared_settings_fields( $fields ) {
		$fields[] = array(
			'section'       => 'translations',
			'section_title' => __( 'Translations', 'fair-platform' ),
			'id'            => 'fair-platform/bundled-translations',
			'type'          => 'checkbox',
			'option'        => Features::OPTION,
			'key'           => 'bundled-translations',
			'label'         => __( 'Fair Platform', 'fair-platform' ),
			'description'   => __( 'Load .mo/.json files shipped with the plugin instead of relying on WordPress.org language packs. Useful while a locale is below the 90% threshold on translate.wordpress.org or for in-progress strings.', 'fair-platform' ),
			'value'         => Features::is_enabled( 'bundled-translations' ),
			'locked'        => Features::is_forced( 'bundled-translations' ),
			'locked_note'   => __( 'Forced by a wp-config constant — change it there.', 'fair-platform' ),
		);
		return $fields;
	}

	/**
	 * Register REST API endpoints
	 *
	 * @return void
	 */
	public function register_rest_api() {
		$connections_controller = new ConnectionsController();
		$connections_controller->register_routes();

		$instagram_connections_controller = new InstagramConnectionsController();
		$instagram_connections_controller->register_routes();

		$instagram_handoff_controller = new InstagramHandoffController();
		$instagram_handoff_controller->register_routes();

		$health_controller = new HealthController();
		$health_controller->register_routes();
	}

	/**
	 * Initialize admin interface
	 *
	 * @return void
	 */
	private function init_admin() {
		if ( is_admin() ) {
			$admin_hooks = new \FairPlatform\Admin\AdminHooks();
			$admin_hooks->init();
		}
	}

	/**
	 * Register OAuth endpoint rewrite rules
	 *
	 * @return void
	 */
	public function register_rewrite_rules() {
		// /oauth/authorize endpoint.
		add_rewrite_rule(
			'^oauth/authorize/?$',
			'index.php?fair_oauth_endpoint=authorize',
			'top'
		);

		// /oauth/callback endpoint.
		add_rewrite_rule(
			'^oauth/callback/?$',
			'index.php?fair_oauth_endpoint=callback',
			'top'
		);

		// /oauth/select-profile endpoint.
		add_rewrite_rule(
			'^oauth/select-profile/?$',
			'index.php?fair_oauth_endpoint=select-profile',
			'top'
		);

		// /oauth/refresh endpoint.
		add_rewrite_rule(
			'^oauth/refresh/?$',
			'index.php?fair_oauth_endpoint=refresh',
			'top'
		);

		// Instagram OAuth endpoints.
		add_rewrite_rule(
			'^oauth/instagram/authorize/?$',
			'index.php?fair_oauth_endpoint=instagram-authorize',
			'top'
		);

		add_rewrite_rule(
			'^oauth/instagram/callback/?$',
			'index.php?fair_oauth_endpoint=instagram-callback',
			'top'
		);

		add_rewrite_rule(
			'^oauth/instagram/refresh/?$',
			'index.php?fair_oauth_endpoint=instagram-refresh',
			'top'
		);
	}

	/**
	 * Add query vars for OAuth endpoints
	 *
	 * @param array $vars Existing query vars.
	 * @return array Modified query vars.
	 */
	public function add_query_vars( $vars ) {
		$vars[] = 'fair_oauth_endpoint';
		return $vars;
	}

	/**
	 * Error reporter for the Mollie OAuth flows.
	 *
	 * @return OAuthErrorReporter
	 */
	private function error_reporter() {
		if ( null === $this->error_reporter ) {
			$this->error_reporter = OAuthErrorReporter::from_config();
		}
		return $this->error_reporter;
	}

	/**
	 * Handle OAuth endpoint requests
	 *
	 * @return void
	 */
	public function handle_oauth_endpoints() {
		$endpoint = get_query_var( 'fair_oauth_endpoint' );

		if ( empty( $endpoint ) ) {
			return;
		}

		switch ( $endpoint ) {
			case 'authorize':
				$this->error_reporter()->watch(
					'authorize',
					function () {
						$this->handle_authorize();
					}
				);
				break;

			case 'callback':
				$this->error_reporter()->watch(
					'callback',
					function () {
						$this->handle_callback();
					}
				);
				break;

			case 'select-profile':
				$this->error_reporter()->watch(
					'select_profile',
					function () {
						$this->handle_select_profile();
					}
				);
				break;

			case 'refresh':
				$this->error_reporter()->watch(
					'refresh',
					function () {
						$this->handle_refresh();
					}
				);
				break;

			case 'instagram-authorize':
				$this->handle_instagram_authorize();
				break;

			case 'instagram-callback':
				$this->handle_instagram_callback();
				break;

			case 'instagram-refresh':
				$this->handle_instagram_refresh();
				break;

			default:
				wp_die( 'Invalid OAuth endpoint', 'Invalid Endpoint', array( 'response' => 404 ) );
		}
	}

	/**
	 * Handle /oauth/authorize endpoint
	 *
	 * @return void
	 */
	private function handle_authorize() {
		// Get and validate parameters.
		$site_id      = sanitize_text_field( $_GET['site_id'] ?? '' );
		$return_url   = esc_url_raw( $_GET['return_url'] ?? '' );
		$site_name    = sanitize_text_field( $_GET['site_name'] ?? '' );
		$site_url     = esc_url_raw( $_GET['site_url'] ?? '' );
		$client_state = sanitize_text_field( $_GET['state'] ?? '' );

		// Optional extra permission: sites running Fair Finance ask for it.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- public OAuth entry point, called from other sites.
		$settlement_access = MollieOAuth::is_settlement_access_requested( sanitize_text_field( wp_unslash( $_GET['settlement_access'] ?? '' ) ) );

		if ( empty( $site_id ) || empty( $return_url ) ) {
			wp_die( 'Missing required parameters: site_id and return_url' );
		}

		// Verify return URL is HTTPS.
		if ( 'https' !== wp_parse_url( $return_url, PHP_URL_SCHEME ) ) {
			wp_die( 'Return URL must use HTTPS' );
		}

		// TODO: Rate limiting check.

		// Generate secure state token.
		$state = hash( 'sha256', $site_id . bin2hex( random_bytes( 32 ) ) );

		// Store state data in transient (10 minutes).
		set_transient(
			"mollie_oauth_{$state}",
			array(
				'site_id'      => $site_id,
				'return_url'   => $return_url,
				'site_name'    => $site_name,
				'site_url'     => $site_url,
				'client_state' => $client_state,
				'timestamp'    => time(),
			),
			600
		);

		// Build Mollie authorization URL.
		$authorize_url = 'https://www.mollie.com/oauth2/authorize?' . http_build_query(
			array(
				'client_id'       => MOLLIE_CLIENT_ID,
				'state'           => $state,
				'scope'           => MollieOAuth::authorization_scope( $settlement_access ),
				'response_type'   => 'code',
				'approval_prompt' => 'auto',
				'redirect_uri'    => home_url( '/oauth/callback' ),
			)
		);

		// Redirect to Mollie.
		wp_redirect( $authorize_url );
		exit;
	}

	/**
	 * Handle /oauth/callback endpoint
	 *
	 * @return void
	 */
	private function handle_callback() {
		// Get parameters.
		$code  = sanitize_text_field( $_GET['code'] ?? '' );
		$state = sanitize_text_field( $_GET['state'] ?? '' );
		$error = sanitize_text_field( $_GET['error'] ?? '' );

		// Check for authorization error.
		if ( ! empty( $error ) ) {
			$error_description = sanitize_text_field( $_GET['error_description'] ?? 'Unknown error' );

			// A cancellation is only returned to the site whose stored state
			// this request carries; the state is single-use either way.
			$data = empty( $state ) ? false : get_transient( "mollie_oauth_{$state}" );
			if ( $data ) {
				delete_transient( "mollie_oauth_{$state}" );
			}

			// A cancellation is the user's choice; other errors for a known
			// state are Mollie failures.
			if ( $data && SafeEvent::is_reportable_authorization_error( $error ) ) {
				$this->error_reporter()->report_failure( 'authorization_error', array( 'oauth_error' => $error ) );
			}

			// Log failed connection.
			$this->log_connection_attempt(
				is_array( $data ) ? $data : array(),
				array(),
				'failed',
				$error,
				$error_description
			);

			$this->return_mollie_error( $data, $error, $error_description );
		}

		if ( empty( $code ) || empty( $state ) ) {
			wp_die( 'Missing required parameters: code and state' );
		}

		// Verify state token.
		$data = get_transient( "mollie_oauth_{$state}" );
		if ( ! $data ) {
			wp_die( 'Invalid or expired state token' );
		}

		// Exchange authorization code for tokens.
		$tokens = $this->exchange_code_for_tokens( $code );
		if ( is_wp_error( $tokens ) ) {
			// The authorization code is spent, so this state cannot be retried.
			delete_transient( "mollie_oauth_{$state}" );

			// Log failed connection.
			$this->log_connection_attempt(
				$data,
				array(),
				'failed',
				'token_exchange_failed',
				$tokens->get_error_message()
			);

			$this->return_mollie_error( $data, 'token_exchange_failed', $tokens->get_error_message() );
		}

		// Get organization details.
		$organization = $this->get_organization_basic( $tokens['access_token'] );

		// Fetch available profiles.
		$profiles = $this->get_profiles_list( $tokens['access_token'] );

		// Store session data for profile selection.
		$session_token = hash( 'sha256', $state . bin2hex( random_bytes( 16 ) ) );
		set_transient(
			"mollie_profile_selection_{$session_token}",
			array(
				'access_token'      => $tokens['access_token'],
				'refresh_token'     => $tokens['refresh_token'],
				'expires_in'        => $tokens['expires_in'],
				'scope'             => $tokens['scope'] ?? '',
				'organization_id'   => $organization['id'] ?? '',
				'organization_name' => $organization['name'] ?? '',
				'testmode'          => $organization['testmode'] ?? 0,
				'site_data'         => $data,
				'timestamp'         => time(),
			),
			600 // 10 minutes
		);

		// Clean up state transient.
		delete_transient( "mollie_oauth_{$state}" );

		// Show profile selection page.
		$this->render_profile_selection( $session_token, $profiles, $data, $organization );
		exit;
	}

	/**
	 * Exchange authorization code for tokens
	 *
	 * @param string $code Authorization code from Mollie.
	 * @return array|\WP_Error Token data or error.
	 */
	private function exchange_code_for_tokens( $code ) {
		// Build token exchange request.
		$response = wp_remote_post(
			'https://api.mollie.com/oauth2/tokens',
			array(
				'timeout' => 30,
				'headers' => array(
					'Content-Type' => 'application/x-www-form-urlencoded',
				),
				'body'    => array(
					'grant_type'    => 'authorization_code',
					'code'          => $code,
					'redirect_uri'  => home_url( '/oauth/callback' ),
					'client_id'     => MOLLIE_CLIENT_ID,
					'client_secret' => MOLLIE_CLIENT_SECRET,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			$this->error_reporter()->report_failure( 'transport_failed', array( 'step' => 'token_exchange' ) );
			error_log( 'Mollie token exchange failed: ' . $response->get_error_message() );
			return $response;
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code ) {
			$this->error_reporter()->report_failure(
				'http_error',
				array(
					'step'        => 'token_exchange',
					'http_status' => $status_code,
					'oauth_error' => $body['error'] ?? '',
				)
			);
			$error_message = $body['error_description'] ?? $body['error'] ?? 'Unknown error';
			error_log( "Mollie token exchange failed with status {$status_code}: {$error_message}" );
			return new \WP_Error( 'token_exchange_failed', $error_message );
		}

		if ( empty( $body['access_token'] ) || empty( $body['refresh_token'] ) ) {
			$this->error_reporter()->report_failure( 'invalid_response', array( 'step' => 'token_exchange' ) );
			error_log( 'Mollie token exchange returned invalid data' );
			return new \WP_Error( 'invalid_token_response', 'Invalid token response from Mollie' );
		}

		return array(
			'access_token'  => $body['access_token'],
			'refresh_token' => $body['refresh_token'],
			'expires_in'    => $body['expires_in'] ?? 3600,
			'scope'         => $body['scope'] ?? '',
		);
	}

	/**
	 * Get basic organization details without profile
	 *
	 * @param string $access_token Mollie access token.
	 * @return array Organization details.
	 */
	private function get_organization_basic( $access_token ) {
		$response = wp_remote_get(
			'https://api.mollie.com/v2/organizations/me',
			array(
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			$this->error_reporter()->report_failure( 'transport_failed', array( 'step' => 'organization' ) );
			error_log( 'Fair Platform: Failed to fetch organization: ' . $response->get_error_message() );
			return array();
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status_code ) {
			$this->error_reporter()->report_failure(
				'http_error',
				array(
					'step'        => 'organization',
					'http_status' => $status_code,
				)
			);
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		return array(
			'id'       => $body['id'] ?? '',
			'name'     => $body['name'] ?? '',
			'testmode' => ! empty( $body['_links']['dashboard']['href'] ) && strpos( $body['_links']['dashboard']['href'], 'test-mode' ) !== false ? 1 : 0,
		);
	}

	/**
	 * Get list of profiles for the organization
	 *
	 * @param string $access_token Mollie access token.
	 * @return array List of profiles.
	 */
	private function get_profiles_list( $access_token ) {
		$response = wp_remote_get(
			'https://api.mollie.com/v2/profiles',
			array(
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			$this->error_reporter()->report_failure( 'transport_failed', array( 'step' => 'profiles' ) );
			error_log( 'Fair Platform: Failed to fetch profiles list: ' . $response->get_error_message() );
			return array();
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status_code ) {
			$this->error_reporter()->report_failure(
				'http_error',
				array(
					'step'        => 'profiles',
					'http_status' => $status_code,
				)
			);
			error_log( "Fair Platform: Failed to fetch profiles with status {$status_code}" );
			return array();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		return $body['_embedded']['profiles'] ?? array();
	}

	/**
	 * Get current profile ID using access token
	 *
	 * If no profile exists, automatically creates one for the customer.
	 *
	 * @param string $access_token Mollie access token.
	 * @param array  $site_data Site data from OAuth flow.
	 * @return array Array with 'profile_id' and 'created' flag.
	 */
	private function get_profile_id( $access_token, $site_data = array() ) {
		error_log( 'Fair Platform: Fetching profile for site: ' . ( $site_data['site_name'] ?? 'unknown' ) );

		// Try to get existing profile.
		$response = wp_remote_get(
			'https://api.mollie.com/v2/profiles/me',
			array(
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $access_token,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Fair Platform: Failed to fetch profile (WP_Error): ' . $response->get_error_message() );
			$profile_id = $this->create_profile( $access_token, $site_data );
			return array(
				'profile_id' => $profile_id,
				'created'    => ! empty( $profile_id ),
			);
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body_raw    = wp_remote_retrieve_body( $response );

		error_log( "Fair Platform: Profile fetch response - Status: {$status_code}, Body: {$body_raw}" );

		if ( 200 === $status_code ) {
			$body = json_decode( $body_raw, true );
			error_log( 'Fair Platform: Found existing profile: ' . ( $body['id'] ?? 'NO ID IN RESPONSE' ) );
			return array(
				'profile_id' => $body['id'] ?? '',
				'created'    => false,
			);
		}

		// No profile exists (404) - create one.
		if ( 404 === $status_code ) {
			error_log( 'Fair Platform: No profile found (404), creating one automatically' );
			$profile_id = $this->create_profile( $access_token, $site_data );
			error_log( 'Fair Platform: Profile creation result: ' . ( $profile_id ?: 'FAILED' ) );
			return array(
				'profile_id' => $profile_id,
				'created'    => ! empty( $profile_id ),
			);
		}

		// Other error.
		error_log( "Fair Platform: Failed to fetch profile with status {$status_code}, body: {$body_raw}" );
		return array(
			'profile_id' => '',
			'created'    => false,
		);
	}

	/**
	 * Create a website profile for customer
	 *
	 * @param string $access_token Mollie access token.
	 * @param array  $site_data Site data from OAuth flow.
	 * @return string Profile ID or empty string.
	 */
	private function create_profile( $access_token, $site_data ) {
		$site_name = $site_data['site_name'] ?? 'Website';
		$site_url  = $site_data['site_url'] ?? '';

		// Build profile data.
		$profile_data = array(
			'name'    => $site_name,
			'website' => $site_url,
			'mode'    => 'live',
		);

		error_log( 'Fair Platform: Creating profile with data: ' . wp_json_encode( $profile_data ) );

		// Create profile.
		$response = wp_remote_post(
			'https://api.mollie.com/v2/profiles',
			array(
				'timeout' => 30,
				'headers' => array(
					'Authorization' => 'Bearer ' . $access_token,
					'Content-Type'  => 'application/json',
				),
				'body'    => wp_json_encode( $profile_data ),
			)
		);

		if ( is_wp_error( $response ) ) {
			error_log( 'Fair Platform: Failed to create profile (WP_Error): ' . $response->get_error_message() );
			return '';
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body_raw    = wp_remote_retrieve_body( $response );

		error_log( "Fair Platform: Profile creation response - Status: {$status_code}, Body: {$body_raw}" );

		if ( 201 !== $status_code ) {
			error_log( "Fair Platform: Failed to create profile with status {$status_code}: {$body_raw}" );
			return '';
		}

		$body       = json_decode( $body_raw, true );
		$profile_id = $body['id'] ?? '';

		if ( $profile_id ) {
			error_log( "Fair Platform: Successfully created profile {$profile_id} for {$site_name}" );
		} else {
			error_log( 'Fair Platform: Profile created but no ID in response: ' . $body_raw );
		}

		return $profile_id;
	}

	/**
	 * Render profile selection page
	 *
	 * @param string $session_token Session token for profile selection.
	 * @param array  $profiles List of available profiles.
	 * @param array  $site_data Site data from OAuth flow.
	 * @param array  $organization Organization details.
	 * @return void
	 */
	private function render_profile_selection( $session_token, $profiles, $site_data, $organization ) {
		$site_name = esc_html( $site_data['site_name'] ?? 'Unknown Site' );
		$org_name  = esc_html( $organization['name'] ?? 'Your Organization' );

		?>
		<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>Select Mollie Profile</title>
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				body {
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, sans-serif;
					background: #f6f7f7;
					padding: 40px 20px;
					line-height: 1.6;
				}
				.container {
					max-width: 600px;
					margin: 0 auto;
					background: white;
					padding: 40px;
					border-radius: 8px;
					box-shadow: 0 2px 8px rgba(0,0,0,0.1);
				}
				h1 {
					font-size: 24px;
					margin-bottom: 10px;
					color: #1e1e1e;
				}
				.subtitle {
					color: #646970;
					margin-bottom: 30px;
					padding-bottom: 20px;
					border-bottom: 1px solid #dcdcde;
				}
				.profile-list {
					margin-bottom: 30px;
				}
				.profile-item {
					border: 2px solid #dcdcde;
					border-radius: 6px;
					padding: 20px;
					margin-bottom: 15px;
					cursor: pointer;
					transition: all 0.2s;
				}
				.profile-item:hover {
					border-color: #2271b1;
					background: #f6f7f7;
				}
				.profile-item input[type="radio"] {
					margin-right: 12px;
					width: 18px;
					height: 18px;
					cursor: pointer;
				}
				.profile-item label {
					cursor: pointer;
					display: flex;
					align-items: center;
					font-size: 16px;
				}
				.profile-name {
					font-weight: 600;
					color: #1e1e1e;
				}
				.profile-id {
					color: #646970;
					font-size: 13px;
					font-family: monospace;
					margin-left: auto;
				}
				.profile-status {
					display: block;
					margin-top: 8px;
					font-size: 13px;
					color: #646970;
					margin-left: 30px;
				}
				.badge {
					display: inline-block;
					padding: 2px 8px;
					border-radius: 3px;
					font-size: 11px;
					font-weight: 600;
					margin-left: 8px;
				}
				.badge-verified { background: #00a32a; color: white; }
				.badge-unverified { background: #dba617; color: white; }
				.badge-blocked { background: #d63638; color: white; }
				.submit-btn {
					background: #2271b1;
					color: white;
					border: none;
					padding: 12px 24px;
					font-size: 16px;
					border-radius: 4px;
					cursor: pointer;
					width: 100%;
					font-weight: 600;
					transition: background 0.2s;
				}
				.submit-btn:hover { background: #135e96; }
				.submit-btn:disabled {
					background: #dcdcde;
					cursor: not-allowed;
				}
				.no-profiles {
					text-align: center;
					padding: 40px 20px;
					color: #646970;
				}
				.no-profiles p { margin-bottom: 20px; }
				.create-profile-btn {
					background: #00a32a;
					color: white;
					border: none;
					padding: 12px 24px;
					font-size: 16px;
					border-radius: 4px;
					cursor: pointer;
					font-weight: 600;
					text-decoration: none;
					display: inline-block;
					transition: background 0.2s;
				}
				.create-profile-btn:hover { background: #008a20; }
				.info-box {
					background: #f0f6fc;
					border-left: 4px solid #2271b1;
					padding: 15px;
					margin-bottom: 30px;
					border-radius: 4px;
				}
				.info-box strong { display: block; margin-bottom: 5px; }
			</style>
		</head>
		<body>
			<div class="container">
				<h1>Select Mollie Profile</h1>
				<p class="subtitle">Connecting <strong><?php echo $site_name; ?></strong> to <strong><?php echo $org_name; ?></strong></p>

				<div class="info-box">
					<strong>Choose a payment profile</strong>
					<p>Select which Mollie website profile should be used for payments on this WordPress site.</p>
				</div>

				<?php if ( empty( $profiles ) ) : ?>
					<div class="no-profiles">
						<p><strong>No payment profiles found</strong></p>
						<p>You need to create a website profile in your Mollie Dashboard before you can accept payments.</p>
						<a href="https://www.mollie.com/dashboard/settings/profiles" target="_blank" class="create-profile-btn">Create Profile in Mollie Dashboard</a>
					</div>
				<?php else : ?>
					<form method="POST" action="<?php echo esc_url( home_url( '/oauth/select-profile' ) ); ?>">
						<input type="hidden" name="session_token" value="<?php echo esc_attr( $session_token ); ?>">
						<input type="hidden" name="nonce" value="<?php echo esc_attr( wp_create_nonce( 'profile_selection_' . $session_token ) ); ?>">

						<div class="profile-list">
							<?php foreach ( $profiles as $profile ) : ?>
								<?php
								$profile_id   = $profile['id'] ?? '';
								$profile_name = $profile['name'] ?? 'Unnamed Profile';
								$status       = $profile['status'] ?? 'unknown';
								$website      = $profile['website'] ?? '';

								$status_badges = array(
									'verified'   => 'Verified',
									'unverified' => 'Unverified',
									'blocked'    => 'Blocked',
								);
								$status_text   = $status_badges[ $status ] ?? ucfirst( $status );
								?>
								<div class="profile-item" onclick="this.querySelector('input').checked = true;">
									<label>
										<input type="radio" name="profile_id" value="<?php echo esc_attr( $profile_id ); ?>" required>
										<span class="profile-name"><?php echo esc_html( $profile_name ); ?></span>
										<span class="badge badge-<?php echo esc_attr( $status ); ?>"><?php echo esc_html( $status_text ); ?></span>
										<span class="profile-id"><?php echo esc_html( $profile_id ); ?></span>
									</label>
									<?php if ( $website ) : ?>
										<span class="profile-status">Website: <?php echo esc_html( $website ); ?></span>
									<?php endif; ?>
								</div>
							<?php endforeach; ?>
						</div>

						<button type="submit" class="submit-btn">Continue with Selected Profile</button>
					</form>
				<?php endif; ?>
			</div>
		</body>
		</html>
		<?php
	}

	/**
	 * Handle /oauth/select-profile endpoint
	 *
	 * @return void
	 */
	private function handle_select_profile() {
		// Only accept POST requests.
		if ( 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			wp_die( 'Method not allowed', 'Method Not Allowed', array( 'response' => 405 ) );
		}

		$session_token = sanitize_text_field( $_POST['session_token'] ?? '' );
		$profile_id    = sanitize_text_field( $_POST['profile_id'] ?? '' );
		$nonce         = sanitize_text_field( $_POST['nonce'] ?? '' );

		if ( empty( $session_token ) || empty( $profile_id ) ) {
			wp_die( 'Missing required parameters' );
		}

		// Verify nonce.
		if ( ! wp_verify_nonce( $nonce, 'profile_selection_' . $session_token ) ) {
			wp_die( 'Invalid security token' );
		}

		// Get session data.
		$session_data = get_transient( "mollie_profile_selection_{$session_token}" );
		if ( ! $session_data ) {
			wp_die( 'Session expired or invalid' );
		}

		// Clean up session transient.
		delete_transient( "mollie_profile_selection_{$session_token}" );

		$site_data = $session_data['site_data'];

		// Log successful connection.
		$this->log_connection_attempt(
			$site_data,
			array(
				'organization_id' => $session_data['organization_id'] ?? '',
				'profile_id'      => $profile_id,
				'testmode'        => $session_data['testmode'] ?? 0,
				'scope'           => $session_data['scope'] ?? '',
				'profile_created' => false,
			),
			'connected'
		);

		// Build redirect URL with tokens.
		$redirect_url = add_query_arg(
			array(
				'mollie_access_token'    => $session_data['access_token'],
				'mollie_refresh_token'   => $session_data['refresh_token'],
				'mollie_expires_in'      => $session_data['expires_in'],
				'mollie_organization_id' => $session_data['organization_id'] ?? '',
				'mollie_profile_id'      => $profile_id,
				'mollie_test_mode'       => $session_data['testmode'] ?? 0,
				'mollie_scope'           => rawurlencode( $session_data['scope'] ?? '' ),
				'state'                  => $site_data['client_state'] ?? '',
			),
			$site_data['return_url']
		);

		// Redirect back to WordPress site.
		wp_redirect( $redirect_url );
		exit;
	}

	/**
	 * Return a Mollie authorization error to the site that started it, or
	 * show it here when no stored state names a site.
	 *
	 * @param mixed  $state_data Stored state data, or false when the state is unknown or expired.
	 * @param string $error Error code.
	 * @param string $description Error description.
	 * @return void
	 */
	private function return_mollie_error( $state_data, $error, $description ) {
		$redirect_url = MollieOAuth::error_return_url( $state_data, $error, $description );

		if ( '' === $redirect_url ) {
			$this->redirect_with_error( '', $error, $description );
		}

		// phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- returns to the connecting site, taken from this platform's own stored state.
		wp_redirect( $redirect_url );
		exit;
	}

	/**
	 * Redirect with error parameters
	 *
	 * @param string $return_url Return URL (empty if unavailable).
	 * @param string $error Error code.
	 * @param string $description Error description.
	 * @return void
	 */
	private function redirect_with_error( $return_url, $error, $description ) {
		if ( empty( $return_url ) ) {
			wp_die(
				sprintf(
					'OAuth error: %s - %s',
					esc_html( $error ),
					esc_html( $description )
				)
			);
		}

		$redirect_url = add_query_arg(
			array(
				'error'             => $error,
				'error_description' => $description,
			),
			$return_url
		);

		wp_redirect( $redirect_url );
		exit;
	}

	/**
	 * Handle /oauth/refresh endpoint
	 *
	 * @return void
	 */
	private function handle_refresh() {
		// Only accept POST requests.
		if ( 'POST' !== $_SERVER['REQUEST_METHOD'] ) {
			wp_send_json_error( array( 'message' => 'Method not allowed' ), 405 );
		}

		// Get refresh token.
		$refresh_token = sanitize_text_field( $_POST['refresh_token'] ?? '' );

		if ( empty( $refresh_token ) ) {
			wp_send_json_error( array( 'message' => 'Missing refresh_token' ), 400 );
		}

		// Exchange refresh token for new access token.
		$response = wp_remote_post(
			'https://api.mollie.com/oauth2/tokens',
			array(
				'timeout' => 30,
				'headers' => array(
					'Content-Type' => 'application/x-www-form-urlencoded',
				),
				'body'    => array(
					'grant_type'    => 'refresh_token',
					'refresh_token' => $refresh_token,
					'client_id'     => MOLLIE_CLIENT_ID,
					'client_secret' => MOLLIE_CLIENT_SECRET,
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			$this->error_reporter()->report_failure( 'transport_failed', array( 'step' => 'token_refresh' ) );
			error_log( 'Mollie token refresh failed: ' . $response->get_error_message() );
			wp_send_json_error(
				array( 'message' => 'Token refresh failed: ' . $response->get_error_message() ),
				500
			);
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code ) {
			$this->error_reporter()->report_failure(
				'http_error',
				array(
					'step'        => 'token_refresh',
					'http_status' => $status_code,
					'oauth_error' => $body['error'] ?? '',
				)
			);
			$error_message = $body['error_description'] ?? $body['error'] ?? 'Unknown error';
			error_log( "Mollie token refresh failed with status {$status_code}: {$error_message}" );
			wp_send_json_error(
				array( 'message' => $error_message ),
				$status_code
			);
		}

		if ( empty( $body['access_token'] ) ) {
			$this->error_reporter()->report_failure( 'invalid_response', array( 'step' => 'token_refresh' ) );
			error_log( 'Mollie token refresh returned invalid data' );
			wp_send_json_error(
				array( 'message' => 'Invalid token response from Mollie' ),
				500
			);
		}

		// Return new access token, with the scope and rotated refresh token
		// when Mollie supplied them.
		wp_send_json_success(
			array(
				'data' => MollieOAuth::refresh_response_data( $body ),
			)
		);
	}

	/**
	 * Handle /oauth/instagram/authorize: check the site's request, store the
	 * attempt under a single-use state, and open Meta's login dialog.
	 *
	 * Nothing is returned to the site from here: until the request is
	 * checked, its return destination is not trusted.
	 *
	 * @return void
	 */
	private function handle_instagram_authorize() {
		$config = InstagramUnifiedLogin::config();
		if ( null === $config ) {
			wp_die( esc_html__( 'Instagram connections are not configured on this service yet. Try again later.', 'fair-platform' ), '', array( 'response' => 503 ) );
		}

		try {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a cross-site OAuth entry point, checked in validate_authorize_request().
			$attempt = InstagramUnifiedLogin::validate_authorize_request( wp_unslash( $_GET ) );
		} catch ( InstagramOAuthException $e ) {
			$this->log_instagram_connection( array(), array(), 'failed', $e->reason() );
			wp_die(
				InstagramUnifiedLogin::ERROR_CLIENT_OUTDATED === $e->reason()
					? esc_html__( 'This site uses the retired Instagram connection. Update Fair Events Experimental, then connect again from Fair Events → Instagram.', 'fair-platform' )
					: esc_html__( 'This Instagram connection request is not valid. Start again from Fair Events → Instagram on your site.', 'fair-platform' ),
				'',
				array( 'response' => 400 )
			);
		}

		$state = ( new OneTimeStore( self::INSTAGRAM_STATE_STORE ) )->put( $attempt, InstagramUnifiedLogin::STATE_TTL );
		if ( null === $state ) {
			wp_die( esc_html__( 'The Instagram connection could not be started. Try again.', 'fair-platform' ), '', array( 'response' => 500 ) );
		}

		// phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- Meta's login dialog.
		wp_redirect( InstagramUnifiedLogin::authorize_url( $config, home_url( '/oauth/instagram/callback' ), $state ) );
		exit;
	}

	/**
	 * Handle /oauth/instagram/callback: consume the state first, then finish
	 * the authorization and send the site a single-use handoff code. Every
	 * failure goes back to the site as a fixed code, and no credentials are
	 * stored for it.
	 *
	 * @return void
	 */
	private function handle_instagram_callback() {
		// Meta's redirect; the single-use state is the CSRF check. WordPress
		// removes `error` from $_GET while parsing the request, so the raw
		// query string is read instead.
		$query = array();
		wp_parse_str( isset( $_SERVER['QUERY_STRING'] ) ? (string) wp_unslash( $_SERVER['QUERY_STRING'] ) : '', $query ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- each value is sanitized below.

		$state        = sanitize_text_field( is_string( $query['state'] ?? null ) ? $query['state'] : '' );
		$code         = sanitize_text_field( is_string( $query['code'] ?? null ) ? $query['code'] : '' );
		$error        = sanitize_key( is_string( $query['error'] ?? null ) ? $query['error'] : '' );
		$error_reason = sanitize_key( is_string( $query['error_reason'] ?? null ) ? $query['error_reason'] : '' );
		if ( '' === $error && '' !== $error_reason ) {
			$error = 'unknown';
		}

		$attempt = ( new OneTimeStore( self::INSTAGRAM_STATE_STORE ) )->take( $state );
		if ( ! is_array( $attempt ) || empty( $attempt['return_url'] ) ) {
			wp_die( esc_html__( 'This Instagram authorization expired or was already used. Start again from Fair Events → Instagram on your site.', 'fair-platform' ), '', array( 'response' => 400 ) );
		}

		try {
			list( $handoff, $account, $details ) = $this->complete_instagram_authorization( $attempt, $code, $error, $error_reason );
		} catch ( InstagramOAuthException $e ) {
			$this->log_instagram_connection( $attempt, array(), 'failed', $e->reason() );
			// phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- the return destination checked and stored with the attempt.
			wp_redirect( InstagramUnifiedLogin::error_redirect_url( $attempt, $e->reason() ) );
			exit;
		}

		$this->log_instagram_connection(
			$attempt,
			array(
				'instagram_user_id'  => $account['id'],
				'instagram_username' => $account['username'],
				'scope'              => implode( ',', $details['scopes'] ),
			),
			'connected'
		);

		// phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect -- the return destination checked and stored with the attempt.
		wp_redirect( InstagramUnifiedLogin::success_redirect_url( $attempt, $handoff ) );
		exit;
	}

	/**
	 * Finish an Instagram authorization whose state was consumed: exchange
	 * the code, check the token and the shared account, and store them
	 * under a handoff code.
	 *
	 * @param array  $attempt      Stored attempt.
	 * @param string $code         Authorization code, '' when none.
	 * @param string $error        Meta `error`, '' when none.
	 * @param string $error_reason Meta `error_reason`.
	 * @return array{0: string, 1: array, 2: array} Handoff code, account and token details.
	 * @throws InstagramOAuthException With the code to return to the site.
	 */
	private function complete_instagram_authorization( array $attempt, $code, $error, $error_reason ) {
		// phpcs:disable WordPress.Security.EscapeOutput.ExceptionNotEscaped -- fixed InstagramUnifiedLogin::ERROR_* codes, never printed.
		if ( '' !== $error ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::callback_error( $error, $error_reason ) );
		}

		$config = InstagramUnifiedLogin::config();
		if ( null === $config ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_SERVER );
		}
		if ( '' === $code ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_AUTHORIZATION_FAILED );
		}

		$meta    = new InstagramMetaClient( $config );
		$token   = $meta->exchange_code( $code, home_url( '/oauth/instagram/callback' ) );
		$details = InstagramUnifiedLogin::evaluate_token( $meta->debug_token( $token ), $config['app_id'] );
		$account = InstagramUnifiedLogin::select_account( $meta->assigned_instagram_accounts( $token ) );

		$handoff = ( new OneTimeStore( InstagramHandoffController::STORE ) )->put(
			InstagramUnifiedLogin::handoff_payload( $token, $details, $account, $attempt, $config['graph_version'] ),
			InstagramUnifiedLogin::HANDOFF_TTL
		);
		if ( null === $handoff ) {
			throw new InstagramOAuthException( InstagramUnifiedLogin::ERROR_SERVER );
		}

		// phpcs:enable WordPress.Security.EscapeOutput.ExceptionNotEscaped

		return array( $handoff, $account, $details );
	}

	/**
	 * Handle /oauth/instagram/refresh, retired with the Instagram Login flow.
	 * Unified Login tokens are never sent here: they do not expire, and
	 * Instagram's refresh endpoint does not accept them.
	 *
	 * @return void
	 */
	private function handle_instagram_refresh() {
		wp_send_json_error(
			array(
				'code'    => 'instagram_refresh_retired',
				'message' => 'Instagram token renewal was retired. Update Fair Events Experimental and Fair Audience Experimental, then connect again from Fair Events → Instagram.',
			),
			410
		);
	}

	/**
	 * Log an Instagram connection attempt
	 *
	 * @param array  $site_data Site data from OAuth flow.
	 * @param array  $instagram_data Instagram account data.
	 * @param string $status Connection status (connected, failed).
	 * @param string $error_code Optional error code.
	 * @param string $error_message Optional error message.
	 * @return void
	 */
	private function log_instagram_connection( $site_data, $instagram_data, $status, $error_code = null, $error_message = null ) {
		$repository = new InstagramConnectionRepository();

		$site_url = isset( $site_data['site_url'] ) ? (string) $site_data['site_url'] : '';
		$log_data = array(
			'site_id'            => '' !== $site_url ? (string) wp_parse_url( $site_url, PHP_URL_HOST ) : '',
			'site_name'          => $site_data['site_name'] ?? '',
			'site_url'           => $site_data['site_url'] ?? '',
			'instagram_user_id'  => $instagram_data['instagram_user_id'] ?? '',
			'instagram_username' => $instagram_data['instagram_username'] ?? '',
			'status'             => $status,
			'error_code'         => $error_code,
			'error_message'      => $error_message,
			'scope_granted'      => $instagram_data['scope'] ?? '',
		);

		$repository->log_connection( $log_data );
	}

	/**
	 * Show admin notice for missing Instagram credentials
	 *
	 * @return void
	 */
	public function missing_instagram_credentials_notice() {
		$message = sprintf(
			'<strong>%1$s</strong> %2$s',
			esc_html__( 'Fair Platform:', 'fair-platform' ),
			esc_html__(
				'Instagram connections are not configured. Add META_APP_ID, META_APP_SECRET and META_INSTAGRAM_CONFIG_ID (the Unified Login configuration ID) to wp-config.php; META_GRAPH_VERSION is optional.',
				'fair-platform'
			)
		);

		wp_admin_notice(
			$message,
			array(
				'type'        => 'warning',
				'dismissible' => false,
			)
		);
	}

	/**
	 * Show admin notice for missing credentials
	 *
	 * @return void
	 */
	public function missing_credentials_notice() {
		$message = sprintf(
			'<strong>%1$s</strong> %2$s',
			esc_html__( 'Fair Platform:', 'fair-platform' ),
			esc_html__(
				'Mollie OAuth credentials not configured. Please add MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET to wp-config.php',
				'fair-platform'
			)
		);

		wp_admin_notice(
			$message,
			array(
				'type'        => 'error',
				'dismissible' => false,
			)
		);
	}

	/**
	 * Show admin notice for missing Mollie library
	 *
	 * @return void
	 */
	public function missing_library_notice() {
		$message = sprintf(
			'<strong>%1$s</strong> %2$s',
			esc_html__( 'Fair Platform:', 'fair-platform' ),
			esc_html__(
				'Mollie PHP library not installed. Please run: composer require mollie/mollie-api-php',
				'fair-platform'
			)
		);

		wp_admin_notice(
			$message,
			array(
				'type'        => 'error',
				'dismissible' => false,
			)
		);
	}

	/**
	 * Log a connection attempt
	 *
	 * @param array  $site_data Site data from OAuth flow.
	 * @param array  $mollie_data Mollie organization and profile data.
	 * @param string $status Connection status (connected, failed, disconnected).
	 * @param string $error_code Optional error code.
	 * @param string $error_message Optional error message.
	 * @return void
	 */
	private function log_connection_attempt( $site_data, $mollie_data, $status, $error_code = null, $error_message = null ) {
		$repository = new ConnectionRepository();

		$log_data = array(
			'site_id'                => $site_data['site_id'] ?? '',
			'site_name'              => $site_data['site_name'] ?? '',
			'site_url'               => $site_data['site_url'] ?? '',
			'mollie_organization_id' => $mollie_data['organization_id'] ?? '',
			'mollie_profile_id'      => $mollie_data['profile_id'] ?? '',
			'status'                 => $status,
			'error_code'             => $error_code,
			'error_message'          => $error_message,
			'scope_granted'          => $mollie_data['scope'] ?? '',
			'profile_created'        => $mollie_data['profile_created'] ?? false,
		);

		$repository->log_connection( $log_data );
	}

	/**
	 * Plugin activation hook
	 *
	 * @return void
	 */
	public static function activate() {
		// Create database tables.
		Schema::create_tables();

		// Register rewrite rules.
		add_rewrite_rule(
			'^oauth/authorize/?$',
			'index.php?fair_oauth_endpoint=authorize',
			'top'
		);

		add_rewrite_rule(
			'^oauth/callback/?$',
			'index.php?fair_oauth_endpoint=callback',
			'top'
		);

		add_rewrite_rule(
			'^oauth/select-profile/?$',
			'index.php?fair_oauth_endpoint=select-profile',
			'top'
		);

		add_rewrite_rule(
			'^oauth/refresh/?$',
			'index.php?fair_oauth_endpoint=refresh',
			'top'
		);

		// Instagram OAuth endpoints.
		add_rewrite_rule(
			'^oauth/instagram/authorize/?$',
			'index.php?fair_oauth_endpoint=instagram-authorize',
			'top'
		);

		add_rewrite_rule(
			'^oauth/instagram/callback/?$',
			'index.php?fair_oauth_endpoint=instagram-callback',
			'top'
		);

		add_rewrite_rule(
			'^oauth/instagram/refresh/?$',
			'index.php?fair_oauth_endpoint=instagram-refresh',
			'top'
		);

		// Flush rewrite rules.
		flush_rewrite_rules();
	}

	/**
	 * Plugin deactivation hook
	 *
	 * @return void
	 */
	public static function deactivate() {
		// Flush rewrite rules.
		flush_rewrite_rules();
	}
}
