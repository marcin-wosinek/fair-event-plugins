<?php
/**
 * Main Plugin Class
 *
 * @package FairPlatform
 */

namespace FairPlatform\Core;

defined( 'ABSPATH' ) || die;

/**
 * Main plugin class
 */
class Plugin {
	/**
	 * Singleton instance
	 *
	 * @var Plugin
	 */
	private static $instance = null;

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
	}

	/**
	 * Initialize WordPress hooks
	 *
	 * @return void
	 */
	private function init_hooks() {
		// Register rewrite rules for OAuth endpoints.
		add_action( 'init', array( $this, 'register_rewrite_rules' ) );
		add_filter( 'query_vars', array( $this, 'add_query_vars' ) );
		add_action( 'template_redirect', array( $this, 'handle_oauth_endpoints' ) );

		// Admin hooks.
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
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

		// /oauth/refresh endpoint.
		add_rewrite_rule(
			'^oauth/refresh/?$',
			'index.php?fair_oauth_endpoint=refresh',
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
				$this->handle_authorize();
				break;

			case 'callback':
				$this->handle_callback();
				break;

			case 'refresh':
				$this->handle_refresh();
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
		$site_id    = sanitize_text_field( $_GET['site_id'] ?? '' );
		$return_url = esc_url_raw( $_GET['return_url'] ?? '' );
		$site_name  = sanitize_text_field( $_GET['site_name'] ?? '' );
		$site_url   = esc_url_raw( $_GET['site_url'] ?? '' );

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
				'site_id'    => $site_id,
				'return_url' => $return_url,
				'site_name'  => $site_name,
				'site_url'   => $site_url,
				'timestamp'  => time(),
			),
			600
		);

		// Build Mollie authorization URL.
		$authorize_url = 'https://www.mollie.com/oauth2/authorize?' . http_build_query(
			array(
				'client_id'       => MOLLIE_CLIENT_ID,
				'state'           => $state,
				'scope'           => 'payments.read payments.write refunds.read refunds.write organizations.read',
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
			$this->redirect_with_error( '', $error, $error_description );
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
			$this->redirect_with_error(
				$data['return_url'],
				'token_exchange_failed',
				$tokens->get_error_message()
			);
		}

		// Get organization details using access token.
		$organization = $this->get_organization_details( $tokens['access_token'] );

		// Clean up state transient.
		delete_transient( "mollie_oauth_{$state}" );

		// Build redirect URL with tokens.
		$redirect_url = add_query_arg(
			array(
				'mollie_access_token'    => $tokens['access_token'],
				'mollie_refresh_token'   => $tokens['refresh_token'],
				'mollie_expires_in'      => $tokens['expires_in'],
				'mollie_organization_id' => $organization['id'] ?? '',
				'mollie_test_mode'       => $organization['testmode'] ?? 0,
			),
			$data['return_url']
		);

		// Redirect back to WordPress site.
		wp_redirect( $redirect_url );
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
			error_log( 'Mollie token exchange failed: ' . $response->get_error_message() );
			return $response;
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code ) {
			$error_message = $body['error_description'] ?? $body['error'] ?? 'Unknown error';
			error_log( "Mollie token exchange failed with status {$status_code}: {$error_message}" );
			return new \WP_Error( 'token_exchange_failed', $error_message );
		}

		if ( empty( $body['access_token'] ) || empty( $body['refresh_token'] ) ) {
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
	 * Get organization details using access token
	 *
	 * @param string $access_token Mollie access token.
	 * @return array Organization details.
	 */
	private function get_organization_details( $access_token ) {
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
			error_log( 'Failed to fetch organization details: ' . $response->get_error_message() );
			return array();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		return array(
			'id'       => $body['id'] ?? '',
			'name'     => $body['name'] ?? '',
			'testmode' => ! empty( $body['_links']['dashboard']['href'] ) && strpos( $body['_links']['dashboard']['href'], 'test-mode' ) !== false ? 1 : 0,
		);
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
			error_log( 'Mollie token refresh failed: ' . $response->get_error_message() );
			wp_send_json_error(
				array( 'message' => 'Token refresh failed: ' . $response->get_error_message() ),
				500
			);
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 !== $status_code ) {
			$error_message = $body['error_description'] ?? $body['error'] ?? 'Unknown error';
			error_log( "Mollie token refresh failed with status {$status_code}: {$error_message}" );
			wp_send_json_error(
				array( 'message' => $error_message ),
				$status_code
			);
		}

		if ( empty( $body['access_token'] ) ) {
			error_log( 'Mollie token refresh returned invalid data' );
			wp_send_json_error(
				array( 'message' => 'Invalid token response from Mollie' ),
				500
			);
		}

		// Return new access token.
		wp_send_json_success(
			array(
				'data' => array(
					'access_token' => $body['access_token'],
					'expires_in'   => $body['expires_in'] ?? 3600,
				),
			)
		);
	}

	/**
	 * Register admin menu
	 *
	 * @return void
	 */
	public function register_admin_menu() {
		add_menu_page(
			__( 'Fair Platform', 'fair-platform' ),
			__( 'Fair Platform', 'fair-platform' ),
			'manage_options',
			'fair-platform',
			array( $this, 'render_admin_page' ),
			'dashicons-admin-plugins'
		);
	}

	/**
	 * Render admin page
	 *
	 * @return void
	 */
	public function render_admin_page() {
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Fair Platform - Mollie OAuth Integration', 'fair-platform' ); ?></h1>

			<div class="card">
				<h2><?php esc_html_e( 'Configuration Status', 'fair-platform' ); ?></h2>

				<table class="form-table">
					<tr>
						<th><?php esc_html_e( 'Mollie Client ID', 'fair-platform' ); ?></th>
						<td>
							<?php if ( defined( 'MOLLIE_CLIENT_ID' ) && MOLLIE_CLIENT_ID ) : ?>
								<span class="dashicons dashicons-yes-alt" style="color: green;"></span>
								<?php echo esc_html( substr( MOLLIE_CLIENT_ID, 0, 20 ) . '...' ); ?>
							<?php else : ?>
								<span class="dashicons dashicons-no-alt" style="color: red;"></span>
								<?php esc_html_e( 'Not configured', 'fair-platform' ); ?>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Mollie Client Secret', 'fair-platform' ); ?></th>
						<td>
							<?php if ( defined( 'MOLLIE_CLIENT_SECRET' ) && MOLLIE_CLIENT_SECRET ) : ?>
								<span class="dashicons dashicons-yes-alt" style="color: green;"></span>
								<?php esc_html_e( 'Configured', 'fair-platform' ); ?>
							<?php else : ?>
								<span class="dashicons dashicons-no-alt" style="color: red;"></span>
								<?php esc_html_e( 'Not configured', 'fair-platform' ); ?>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Mollie PHP Library', 'fair-platform' ); ?></th>
						<td>
							<?php if ( class_exists( '\Mollie\Api\MollieApiClient' ) ) : ?>
								<span class="dashicons dashicons-yes-alt" style="color: green;"></span>
								<?php esc_html_e( 'Installed', 'fair-platform' ); ?>
							<?php else : ?>
								<span class="dashicons dashicons-no-alt" style="color: red;"></span>
								<?php esc_html_e( 'Not installed', 'fair-platform' ); ?>
							<?php endif; ?>
						</td>
					</tr>
				</table>
			</div>

			<div class="card">
				<h2><?php esc_html_e( 'OAuth Endpoints', 'fair-platform' ); ?></h2>
				<ul>
					<li><code><?php echo esc_url( home_url( '/oauth/authorize' ) ); ?></code></li>
					<li><code><?php echo esc_url( home_url( '/oauth/callback' ) ); ?></code></li>
					<li><code><?php echo esc_url( home_url( '/oauth/refresh' ) ); ?></code></li>
				</ul>
				<p class="description">
					<?php esc_html_e( 'These endpoints must be accessible via HTTPS.', 'fair-platform' ); ?>
				</p>
			</div>

			<div class="card">
				<h2><?php esc_html_e( 'Documentation', 'fair-platform' ); ?></h2>
				<p>
					<?php
					printf(
						/* translators: %s: IMPLEMENTATION.md link */
						esc_html__( 'See %s for detailed implementation documentation.', 'fair-platform' ),
						'<code>IMPLEMENTATION.md</code>'
					);
					?>
				</p>
			</div>
		</div>
		<?php
	}

	/**
	 * Show admin notice for missing credentials
	 *
	 * @return void
	 */
	public function missing_credentials_notice() {
		?>
		<div class="notice notice-error">
			<p>
				<strong><?php esc_html_e( 'Fair Platform:', 'fair-platform' ); ?></strong>
				<?php
				esc_html_e(
					'Mollie OAuth credentials not configured. Please add MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET to wp-config.php',
					'fair-platform'
				);
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Show admin notice for missing Mollie library
	 *
	 * @return void
	 */
	public function missing_library_notice() {
		?>
		<div class="notice notice-error">
			<p>
				<strong><?php esc_html_e( 'Fair Platform:', 'fair-platform' ); ?></strong>
				<?php
				esc_html_e(
					'Mollie PHP library not installed. Please run: composer require mollie/mollie-api-php',
					'fair-platform'
				);
				?>
			</p>
		</div>
		<?php
	}
}
