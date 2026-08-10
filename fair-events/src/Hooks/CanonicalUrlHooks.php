<?php
/**
 * Per-occurrence canonical URL for recurring event pages
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Helpers\CanonicalUrl;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Filters WordPress' `get_canonical_url` so a recurring event page requested
 * with a specific occurrence selector declares that occurrence's own
 * canonical URL, instead of every occurrence collapsing onto the page's
 * default view.
 */
class CanonicalUrlHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_filter( 'get_canonical_url', array( $this, 'filter_canonical_url' ), 10, 2 );
	}

	/**
	 * Adjust the canonical URL for a singular, enabled-post-type event page.
	 *
	 * @param string   $canonical_url WordPress' computed canonical URL.
	 * @param \WP_Post $post          The queried post.
	 * @return string Canonical URL.
	 */
	public function filter_canonical_url( $canonical_url, $post ) {
		if ( ! is_singular() ) {
			return $canonical_url;
		}

		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post->post_type, $enabled_types, true ) ) {
			return $canonical_url;
		}

		return CanonicalUrl::for_post( $post->ID, $canonical_url );
	}
}
