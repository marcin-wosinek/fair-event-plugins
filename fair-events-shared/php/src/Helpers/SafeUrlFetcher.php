<?php
/**
 * Safe outbound HTTP fetch helper for Fair Event Plugins
 *
 * @package FairEventsShared
 */

namespace FairEventsShared\Helpers;

defined( 'WPINC' ) || die;

use WP_Error;

/**
 * Wraps wp_safe_remote_get() with the fetch/validation rules used to safely
 * read a user-supplied page server-side: short timeout, capped redirects and
 * response size, HTML-only, and rejection of private/internal targets via
 * wp_safe_remote_get()'s own reject_unsafe_urls behaviour.
 */
class SafeUrlFetcher {

	/**
	 * Fetch the given URL and return its HTML body.
	 *
	 * @param string $url URL to fetch. Caller is responsible for validating
	 *                    the scheme is http(s) before calling this.
	 * @return string|WP_Error HTML body on success, WP_Error otherwise.
	 */
	public static function fetch( $url ) {
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
				__( 'Could not reach that page.' ),
				array( 'status' => 502 )
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );

		if ( $status < 200 || $status >= 300 ) {
			return new WP_Error(
				'rest_lookup_bad_status',
				__( 'That page could not be fetched.' ),
				array( 'status' => 502 )
			);
		}

		$content_type = wp_remote_retrieve_header( $response, 'content-type' );

		if ( $content_type && false === stripos( $content_type, 'html' ) ) {
			return new WP_Error(
				'rest_lookup_not_html',
				__( 'That URL did not return a web page.' ),
				array( 'status' => 415 )
			);
		}

		$body = wp_remote_retrieve_body( $response );

		if ( empty( $body ) ) {
			return new WP_Error(
				'rest_lookup_empty',
				__( 'That page had no content to read.' ),
				array( 'status' => 422 )
			);
		}

		return $body;
	}
}
