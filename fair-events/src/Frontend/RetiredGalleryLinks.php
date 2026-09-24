<?php
/**
 * Retired event gallery links
 *
 * @package FairEvents
 */

namespace FairEvents\Frontend;

defined( 'WPINC' ) || die;

/**
 * Answers links issued by the removed event gallery with 410 Gone.
 *
 * Covers `?gallery_key=…` invitation links, `?event_gallery_id=…` and
 * `/event-gallery/{id}`. Tokens are never looked up and no media is
 * rendered: the presence of the parameter or path is enough.
 */
class RetiredGalleryLinks {

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
	 * Register the retired query variables so WordPress parses them.
	 *
	 * @param array $vars Query variables.
	 * @return array Modified query variables.
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'gallery_key';
		$vars[] = 'event_gallery_id';
		return $vars;
	}

	/**
	 * Whether the current request targets a retired gallery link.
	 *
	 * @return bool
	 */
	public static function is_retired_gallery_request() {
		if ( '' !== (string) get_query_var( 'gallery_key' ) || '' !== (string) get_query_var( 'event_gallery_id' ) ) {
			return true;
		}

		// Read the path directly: with plain permalinks WordPress never
		// parses it into $wp->request.
		$uri       = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		$path      = (string) wp_parse_url( $uri, PHP_URL_PATH );
		$home_path = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		if ( '' !== $home_path && str_starts_with( $path, $home_path ) ) {
			$path = substr( $path, strlen( $home_path ) );
		}

		return 1 === preg_match( '#^/?event-gallery/[0-9]+/?$#', $path );
	}

	/**
	 * Stop retired gallery requests with a 410 page.
	 *
	 * @return void
	 */
	public static function handle_request() {
		if ( ! self::is_retired_gallery_request() ) {
			return;
		}

		nocache_headers();
		wp_die(
			esc_html__( 'This event photo gallery is no longer available.', 'fair-events' ),
			esc_html__( 'Gallery removed', 'fair-events' ),
			array( 'response' => 410 )
		);
	}
}
