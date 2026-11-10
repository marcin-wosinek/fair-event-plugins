<?php
/**
 * Shared base for REST controllers that fetch a user-supplied URL server-side
 * and extract event metadata from it
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\API;

defined( 'WPINC' ) || die;

use FairEventsShared\Helpers\PageMetadataParser;
use FairEventsShared\Helpers\SafeUrlFetcher;
use WP_REST_Controller;
use WP_REST_Response;
use WP_Error;

/**
 * Holds the fetch → parse → respond body shared by every URL-lookup
 * controller. Subclasses own routing, permissions, and rate limiting —
 * whatever differs between an admin-only lookup and a public preview.
 */
abstract class AbstractUrlLookupController extends WP_REST_Controller {

	/**
	 * Validate that the given value is a safe http(s) URL.
	 *
	 * @param string $value The url param.
	 * @return bool True when valid.
	 */
	public function validate_url_param( $value ) {
		if ( ! is_string( $value ) || ! wp_http_validate_url( $value ) ) {
			return false;
		}

		$scheme = wp_parse_url( $value, PHP_URL_SCHEME );

		return in_array( $scheme, array( 'http', 'https' ), true );
	}

	/**
	 * Fetch the given URL server-side and extract event metadata from it.
	 *
	 * @param string $url URL to look up.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	protected function lookup_url( $url ) {
		$body = SafeUrlFetcher::fetch( $url );

		if ( is_wp_error( $body ) ) {
			return $body;
		}

		$metadata = PageMetadataParser::parse( $body );

		if ( empty( $metadata['title'] ) ) {
			return new WP_Error(
				'rest_lookup_no_metadata',
				__( 'Could not find any event details on that page.', 'fair-events-shared' ),
				array( 'status' => 422 )
			);
		}

		return new WP_REST_Response( $metadata, 200 );
	}
}
