<?php
/**
 * REST API Controller for previewing event metadata from a URL question answer
 *
 * @package FairForm
 */

namespace FairForm\API;

defined( 'WPINC' ) || die;

use FairEventsShared\API\AbstractUrlLookupController;
use WP_REST_Server;
use WP_REST_Request;
use WP_Error;

/**
 * Fetches a visitor-supplied URL server-side and returns whatever event
 * metadata it publishes, so the form can show a live preview under the field
 * before submission. Public and rate-limited by IP — no email is available
 * pre-submission.
 */
class UrlPreviewController extends AbstractUrlLookupController {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-form/v1';

	/**
	 * Rate limit: max requests per IP per window.
	 */
	const RATE_LIMIT_MAX = 20;

	/**
	 * Rate limit window in seconds (10 minutes).
	 */
	const RATE_LIMIT_WINDOW = 600;

	/**
	 * Register the routes for URL preview.
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-form/v1/url-preview - Fetch a page and preview its event metadata.
		register_rest_route(
			$this->namespace,
			'/url-preview',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					// Public: anonymous visitors preview a URL before submitting.
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'url' => array(
							'description'       => __( 'URL of the linked page to preview.', 'fair-form' ),
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => array( $this, 'validate_url_param' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Fetch the given URL server-side and return its event metadata preview.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		return $this->lookup_url( $request->get_param( 'url' ) );
	}

	/**
	 * Check permissions for previewing a URL, enforcing the per-IP rate limit.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if allowed, WP_Error (429) when rate limited.
	 */
	public function create_item_permissions_check( $request ) {
		$key = $this->get_rate_limit_key();

		if ( $this->is_rate_limited( $key ) ) {
			return new WP_Error(
				'rest_rate_limited',
				__( 'Too many preview requests. Please try again later.', 'fair-form' ),
				array( 'status' => 429 )
			);
		}

		$this->increment_rate_limit( $key );

		return true;
	}

	/**
	 * Build the transient key used for rate limiting, keyed on hashed IP.
	 *
	 * @return string Transient key.
	 */
	private function get_rate_limit_key() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		return 'fair_form_url_preview_ip_' . md5( $ip );
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
