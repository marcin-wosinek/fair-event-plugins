<?php
/**
 * REST API Controller for looking up event metadata from a URL
 *
 * @package FairEvents
 */

namespace FairEvents\API;

defined( 'WPINC' ) || die;

use FairEvents\Helpers\PageMetadataParser;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Fetches a user-supplied page server-side and extracts event metadata from it
 */
class EventLookupController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Register the routes for URL lookup
	 *
	 * @return void
	 */
	public function register_routes() {
		// POST /fair-events/v1/lookup-url - Fetch a page and extract event metadata.
		register_rest_route(
			$this->namespace,
			'/lookup-url',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'url' => array(
							'description'       => __( 'URL of the event page to look up.', 'fair-events' ),
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => array( $this, 'validate_url' ),
						),
					),
				),
			)
		);
	}

	/**
	 * Validate that the given value is a safe http(s) URL.
	 *
	 * @param string $value The url param.
	 * @return bool True when valid.
	 */
	public function validate_url( $value ) {
		if ( ! is_string( $value ) || ! wp_http_validate_url( $value ) ) {
			return false;
		}

		$scheme = wp_parse_url( $value, PHP_URL_SCHEME );

		return in_array( $scheme, array( 'http', 'https' ), true );
	}

	/**
	 * Fetch the given URL server-side and extract event metadata from it
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$url = $request->get_param( 'url' );

		// wp_safe_remote_get() rejects redirects/targets that resolve to
		// private/internal addresses (reject_unsafe_urls), unlike wp_remote_get().
		$response = wp_safe_remote_get(
			$url,
			array(
				'timeout'             => 5,
				'redirection'         => 3,
				'limit_response_size' => 2 * MB_IN_BYTES,
				'headers'             => array(
					'Accept' => 'text/html',
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'rest_lookup_unreachable',
				__( 'Could not reach that page.', 'fair-events' ),
				array( 'status' => 502 )
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return new WP_Error(
				'rest_lookup_bad_status',
				__( 'That page could not be fetched.', 'fair-events' ),
				array( 'status' => 502 )
			);
		}

		$content_type = wp_remote_retrieve_header( $response, 'content-type' );

		if ( $content_type && false === stripos( $content_type, 'html' ) ) {
			return new WP_Error(
				'rest_lookup_not_html',
				__( 'That URL did not return a web page.', 'fair-events' ),
				array( 'status' => 415 )
			);
		}

		$body = wp_remote_retrieve_body( $response );

		if ( empty( $body ) ) {
			return new WP_Error(
				'rest_lookup_empty',
				__( 'That page had no content to read.', 'fair-events' ),
				array( 'status' => 422 )
			);
		}

		$metadata = PageMetadataParser::parse( $body );

		if ( empty( $metadata['title'] ) ) {
			return new WP_Error(
				'rest_lookup_no_metadata',
				__( 'Could not find any event details on that page.', 'fair-events' ),
				array( 'status' => 422 )
			);
		}

		return new WP_REST_Response( $metadata, 200 );
	}

	/**
	 * Check permissions for looking up event metadata from a URL
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool|WP_Error True if user has permission, WP_Error otherwise.
	 */
	public function create_item_permissions_check( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to look up event pages.', 'fair-events' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}
}
