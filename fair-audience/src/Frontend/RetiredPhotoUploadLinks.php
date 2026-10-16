<?php
/**
 * Retired participant photo upload links
 *
 * @package FairAudience
 */

namespace FairAudience\Frontend;

defined( 'WPINC' ) || die;

/**
 * Answers links to the removed participant photo upload page with 410 Gone.
 *
 * Covers the `?photo_upload=1&participant_token=…` links that "Upload
 * photos" emails carried. The token is never looked up and no upload is
 * accepted: the presence of the parameter is enough. Runs before any other
 * `template_redirect` handler, so an older fair-audience-experimental that
 * still serves the page never gets to it.
 */
class RetiredPhotoUploadLinks {

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_request' ), 0 );
	}

	/**
	 * Register the retired query variable so WordPress parses it.
	 *
	 * @param array $vars Query variables.
	 * @return array Modified query variables.
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'photo_upload';
		return $vars;
	}

	/**
	 * Whether the current request targets a retired photo upload link.
	 *
	 * @return bool
	 */
	public static function is_retired_photo_upload_request() {
		return '' !== (string) get_query_var( 'photo_upload' );
	}

	/**
	 * Stop retired photo upload requests with a 410 page.
	 *
	 * @return void
	 */
	public static function handle_request() {
		if ( ! self::is_retired_photo_upload_request() ) {
			return;
		}

		nocache_headers();
		wp_die(
			esc_html__( 'Photo uploads are no longer available.', 'fair-audience' ),
			esc_html__( 'Photo upload removed', 'fair-audience' ),
			array( 'response' => 410 )
		);
	}
}
