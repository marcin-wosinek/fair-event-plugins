<?php
/**
 * Weekly Digest REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Services\EmailService;
use FairAudience\Services\WeeklyDigestRenderer;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for the weekly events digest: config, sources, preview, test-send.
 */
class WeeklyDigestController extends WP_REST_Controller {

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
	protected $rest_base = 'weekly-digest';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_config' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_config' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => $this->get_config_args(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/sources',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_sources' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/preview',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_test' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);
	}

	/**
	 * Only site admins may read or change the digest configuration.
	 *
	 * @return bool|WP_Error
	 */
	public function permissions_check() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to manage the weekly digest.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	/**
	 * GET /weekly-digest — current config plus last-run info.
	 *
	 * @return WP_REST_Response
	 */
	public function get_config() {
		$config = get_option( 'fair_audience_weekly_digest', WeeklyDigestRenderer::default_config() );

		return rest_ensure_response(
			array(
				'config'          => $config,
				'last_sent_week'  => get_option( 'fair_audience_weekly_digest_last_sent_week', '' ),
				'last_run_result' => get_option( 'fair_audience_weekly_digest_last_run_result', array() ),
			)
		);
	}

	/**
	 * PUT /weekly-digest — update config.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function update_config( WP_REST_Request $request ) {
		$config = WeeklyDigestRenderer::sanitize_config( $request->get_params() );

		update_option( 'fair_audience_weekly_digest', $config );

		return rest_ensure_response( array( 'config' => $config ) );
	}

	/**
	 * GET /weekly-digest/sources — enabled fair-events event sources.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_sources() {
		if ( ! class_exists( 'FairEvents\Core\Plugin' ) ) {
			return rest_ensure_response( array() );
		}

		$repository = new \FairEvents\Database\EventSourceRepository();
		$sources    = $repository->get_all( true );

		$items = array_map(
			function ( $source ) {
				return array(
					'slug' => $source['slug'],
					'name' => $source['name'],
				);
			},
			$sources
		);

		return rest_ensure_response( $items );
	}

	/**
	 * POST /weekly-digest/preview — render the configured week's HTML, no send.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function preview() {
		$week = $this->get_configured_week();

		if ( is_wp_error( $week ) ) {
			return $week;
		}

		$config = get_option( 'fair_audience_weekly_digest', WeeklyDigestRenderer::default_config() );

		return rest_ensure_response(
			array(
				'subject' => WeeklyDigestRenderer::render_subject( $config['subject'], $week ),
				'html'    => WeeklyDigestRenderer::render( $week, $config['intro'] ),
				'week'    => $week['week'],
				'empty'   => WeeklyDigestRenderer::is_week_empty( $week ),
			)
		);
	}

	/**
	 * POST /weekly-digest/test — render and send one mail to the current admin.
	 *
	 * @return WP_REST_Response|WP_Error
	 */
	public function send_test() {
		$week = $this->get_configured_week();

		if ( is_wp_error( $week ) ) {
			return $week;
		}

		$config  = get_option( 'fair_audience_weekly_digest', WeeklyDigestRenderer::default_config() );
		$subject = WeeklyDigestRenderer::render_subject( $config['subject'], $week );
		$html    = WeeklyDigestRenderer::render( $week, $config['intro'] );

		$current_user = wp_get_current_user();

		$email_service = new EmailService();
		$sent          = $email_service->send_html_mail_to_address( $current_user->user_email, $subject, $html );

		if ( ! $sent ) {
			return new WP_Error(
				'send_failed',
				__( 'Failed to send the test email.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response( array( 'sent_to' => $current_user->user_email ) );
	}

	/**
	 * Resolve the week for the currently configured source.
	 *
	 * @return array|WP_Error Week data, or WP_Error when unconfigured/unavailable.
	 */
	private function get_configured_week() {
		if ( ! class_exists( 'FairEvents\Services\WeeklyEventsProvider' ) ) {
			return new WP_Error(
				'fair_events_inactive',
				__( 'The Fair Events plugin must be active.', 'fair-audience' ),
				array( 'status' => 424 )
			);
		}

		$config = get_option( 'fair_audience_weekly_digest', WeeklyDigestRenderer::default_config() );

		if ( empty( $config['source_slug'] ) ) {
			return new WP_Error(
				'no_source',
				__( 'No event source configured for the weekly digest.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		list( $year, $week_num ) = WeeklyDigestRenderer::resolve_week_scope( $config['week_scope'] );

		$provider = new \FairEvents\Services\WeeklyEventsProvider();
		$week     = $provider->get_week( $config['source_slug'], $year, $week_num );

		if ( is_wp_error( $week ) ) {
			return $week;
		}

		return $week;
	}

	/**
	 * Schema-driven args for PUT /weekly-digest.
	 *
	 * @return array Args definition.
	 */
	private function get_config_args() {
		return array(
			'enabled'     => array( 'type' => 'boolean' ),
			'source_slug' => array( 'type' => 'string' ),
			'day_of_week' => array( 'type' => 'integer' ),
			'time_of_day' => array( 'type' => 'string' ),
			'week_scope'  => array(
				'type' => 'string',
				'enum' => array( 'current', 'next' ),
			),
			'skip_empty'  => array( 'type' => 'boolean' ),
			'subject'     => array( 'type' => 'string' ),
			'intro'       => array( 'type' => 'string' ),
		);
	}
}
